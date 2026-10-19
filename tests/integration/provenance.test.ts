import { generateKeyPairSync } from "node:crypto";

import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openQuestion, saveDraftQuestion } from "../../src/lib/services/tournament/admin.js";
import {
  batchCompletedHours,
  getProvenanceProof,
  postPendingBatches,
} from "../../src/lib/services/tournament/provenance.js";
import { upsertIdentity } from "../../src/lib/services/tournament/sign-in.js";
import { forecastEventHash } from "../../src/lib/services/tournament/submit-forecast.js";
import { verifyTournament } from "../../src/lib/services/tournament/verify-tournament.js";
import { base58Encode, parseMemoSigner, type SolanaConfig } from "../../src/lib/solana/memo.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);

import { GET as cronRoute } from "../../src/app/api/t/cron/provenance/route.js";
import { GET as proofRoute } from "../../src/app/api/t/provenance/[eventId]/route.js";

const HOUR = 60 * 60 * 1000;
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Provenance PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Provenance PostgreSQL integration";

function testWallet(): SolanaConfig {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    rpcUrl: "https://rpc.test",
    cluster: "devnet",
    signer: parseMemoSigner(JSON.stringify([...seed, ...pub])),
  };
}

/** A JSON-RPC stand-in: accepts every transaction, reports each as `status`. */
function fakeRpc(status: "finalized" | null) {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    if (body.method === "getLatestBlockhash") {
      return Response.json({ result: { value: { blockhash: base58Encode(Buffer.alloc(32, 5)) } } });
    }
    if (body.method === "sendTransaction") {
      const wire = Buffer.from(body.params[0] as string, "base64");
      return Response.json({ result: base58Encode(wire.subarray(1, 65)) });
    }
    return Response.json({
      result: {
        value: [status === null ? null : { err: null, confirmationStatus: status }],
      },
    });
  }) as unknown as typeof fetch;
}

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;
  let eventIds: string[];
  let hourOne: Date;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    runtime.getRuntimeDatabase.mockReturnValue(postgres.db);
    const userId = await upsertIdentity(postgres.db, {
      provider: "x",
      providerUserId: "42",
      handle: "Prover",
      displayName: "Prover",
      avatarUrl: null,
      verified: false,
      providerCreatedAt: new Date("2015-01-01T00:00:00Z"),
    });
    const now = Date.now();
    await saveDraftQuestion(postgres.db, {
      slug: "proof-q",
      title: "Proof",
      description_md: "D.",
      rulebook_md: "R.",
      rulebook_version: 1,
      unit: "bool",
      opens_at: new Date(now - 48 * HOUR).toISOString(),
      closes_at: new Date(now + HOUR).toISOString(),
    });
    await openQuestion(postgres.db, "proof-q");
    const question = await postgres.db
      .selectFrom("tournament_questions")
      .select("id")
      .executeTakeFirstOrThrow();

    // Three events in one past hour, one in the next, one in the current (unbatched) hour.
    hourOne = new Date(Math.floor((now - 5 * HOUR) / HOUR) * HOUR);
    const times = [
      hourOne.getTime() + 60_000,
      hourOne.getTime() + 120_000,
      hourOne.getTime() + 180_000,
      hourOne.getTime() + HOUR + 60_000,
      now,
    ];
    eventIds = [];
    for (const [index, at] of times.entries()) {
      const submittedAt = new Date(at);
      const probs = [index / 10, 1 - index / 10];
      const row = await postgres.db
        .insertInto("tournament_forecast_events")
        .values({
          user_id: userId,
          question_id: question.id,
          submitted_at: submittedAt,
          probs: probs.map((probability) => probability.toFixed(10)),
          event_hash: forecastEventHash(question.id, userId, submittedAt, probs),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      eventIds.push(row.id);
    }
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  it("commits each completed hour once and proves every event in it", async () => {
    const created = await batchCompletedHours(postgres.db);
    expect(created.map((batch) => [batch.hourStart, batch.leafCount])).toEqual([
      [hourOne.toISOString(), 3],
      [new Date(hourOne.getTime() + HOUR).toISOString(), 1],
    ]);
    expect(await batchCompletedHours(postgres.db)).toEqual([]);

    for (const eventId of eventIds.slice(0, 4)) {
      const proof = await getProvenanceProof(postgres.db, eventId);
      expect(proof).toMatchObject({ hashMatches: true, pathMatches: true });
    }
    const pending = await getProvenanceProof(postgres.db, eventIds[4]!);
    expect(pending).toMatchObject({ hashMatches: true, batch: null, pathMatches: null });

    expect(await verifyTournament(postgres.db)).toMatchObject({
      passed: true,
      batchesChecked: 2,
    });
    await expect(
      sql`update tournament_provenance_batches set root = repeat('0', 64)`.execute(postgres.db),
    ).rejects.toThrow(/immutable/);
    await expect(
      sql`delete from tournament_provenance_leaves`.execute(postgres.db),
    ).rejects.toThrow(/append-only/);
  });

  it("posts, waits, reposts a memo that never landed, and confirms", async () => {
    await batchCompletedHours(postgres.db);
    const wallet = testWallet();
    const start = new Date();

    const first = await postPendingBatches(postgres.db, wallet, fakeRpc(null), start);
    expect(first.posted).toHaveLength(2);
    const waiting = await postPendingBatches(postgres.db, wallet, fakeRpc(null), start);
    expect(waiting.waiting).toHaveLength(2);
    const later = new Date(start.getTime() + 10 * 60_000);
    const reposted = await postPendingBatches(postgres.db, wallet, fakeRpc(null), later);
    expect(reposted.posted).toHaveLength(2);
    const confirmed = await postPendingBatches(postgres.db, wallet, fakeRpc("finalized"), later);
    expect(confirmed.confirmed).toHaveLength(2);
    expect(
      (await postPendingBatches(postgres.db, wallet, fakeRpc("finalized"), later)).confirmed,
    ).toHaveLength(0);

    const proof = await getProvenanceProof(postgres.db, eventIds[0]!);
    expect(proof.batch?.txSignature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    expect(proof.batch?.confirmedAt).not.toBeNull();
  });

  it("serves the proof publicly and guards the cron route with its secret", async () => {
    const unauthorized = await cronRoute(new Request("https://t.test/api/t/cron/provenance"));
    expect(unauthorized.status).toBe(401);

    vi.stubEnv("CRON_SECRET", "a-long-enough-cron-secret");
    vi.stubEnv("SOLANA_PROVENANCE_SECRET_KEY", "");
    const run = await cronRoute(
      new Request("https://t.test/api/t/cron/provenance", {
        headers: { authorization: "Bearer a-long-enough-cron-secret" },
      }),
    );
    expect(run.status).toBe(200);
    expect(await run.json()).toMatchObject({ posting: null });

    const proof = await proofRoute(new Request(`https://t.test/api/t/provenance/${eventIds[0]}`), {
      params: Promise.resolve({ eventId: eventIds[0]! }),
    });
    expect(proof.status).toBe(200);
    expect(proof.headers.get("cache-control")).toContain("max-age=10");
    expect(await proof.json()).toMatchObject({ pathMatches: true, event: { handle: "Prover" } });
  });
});
