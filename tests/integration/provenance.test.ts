import { createHash, generateKeyPairSync } from "node:crypto";

import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyProofInBrowser } from "../../src/lib/client/provenance.js";
import { openQuestion, saveDraftQuestion } from "../../src/lib/services/tournament/admin.js";
import {
  batchCompletedHours,
  getProvenanceProof,
  postPendingBatches,
} from "../../src/lib/services/tournament/provenance.js";
import { upsertIdentity } from "../../src/lib/services/tournament/sign-in.js";
import {
  forecastEventHash,
  submitForecast,
} from "../../src/lib/services/tournament/submit-forecast.js";
import { verifyTournament } from "../../src/lib/services/tournament/verify-tournament.js";
import { base58Encode, parseMemoSigner, type SolanaConfig } from "../../src/lib/solana/memo.js";
import {
  createPostgresTestDatabase,
  migrateTestDatabase,
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
  let userId: string;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    runtime.getRuntimeDatabase.mockReturnValue(postgres.db);
    ({ userId } = await upsertIdentity(postgres.db, {
      provider: "x",
      providerUserId: "42",
      handle: "Prover",
      displayName: "Prover",
      avatarUrl: null,
      verified: false,
      providerCreatedAt: new Date("2015-01-01T00:00:00Z"),
    }));
    const now = Date.now();
    await saveDraftQuestion(postgres.db, {
      slug: "proof-q",
      title: "Proof",
      description_md: "D.",
      rulebook_md: "R.",
      rulebook_version: 1,
      kind: "binary",
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
      const p = (index + 1) / 10;
      const row = await postgres.db
        .insertInto("tournament_forecast_events")
        .values({
          user_id: userId,
          question_id: question.id,
          submitted_at: submittedAt,
          p: p.toFixed(10),
          event_hash: forecastEventHash(question.id, userId, submittedAt, { p, value: null }),
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
    // A binary's payload is byte for byte the pre-013 [p, 1 − p] vector.
    expect(pending.event).toMatchObject({
      p: 0.5,
      value: null,
      archivedProbs: null,
      payloadCanonical: "0.5000000000,0.5000000000",
    });

    const first = await getProvenanceProof(postgres.db, eventIds[0]!);
    expect(await verifyProofInBrowser(first)).toMatchObject({
      payload: "0.1000000000,0.9000000000",
      hashMatches: true,
      rootMatches: true,
    });

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

  it("proves a forward event by its prefixed payload, on the server and in the browser", async () => {
    const now = Date.now();
    await saveDraftQuestion(postgres.db, {
      slug: "proof-fwd",
      title: "Proof forward",
      description_md: "D.",
      rulebook_md: "R.",
      rulebook_version: 1,
      kind: "forward",
      unit: "USD_B",
      opens_at: new Date(now - HOUR).toISOString(),
      closes_at: new Date(now + HOUR).toISOString(),
      expiry_at: new Date(now + 2 * HOUR).toISOString(),
    });
    await openQuestion(postgres.db, "proof-fwd");
    const stored = await submitForecast(postgres.db, { slug: "proof-fwd", userId, value: 412.5 });
    const proof = await getProvenanceProof(postgres.db, stored.id);
    expect(proof).toMatchObject({ hashMatches: true, batch: null });
    expect(proof.event).toMatchObject({
      p: null,
      value: 412.5,
      archivedProbs: null,
      payloadCanonical: "fwd:412.5000000000",
      eventHash: stored.eventHash,
    });
    expect(await verifyProofInBrowser(proof)).toMatchObject({
      payload: "fwd:412.5000000000",
      eventHash: stored.eventHash,
      hashMatches: true,
      root: null,
    });
    // A tampered level no longer hashes to the stored event hash.
    expect(
      (await verifyProofInBrowser({ ...proof, event: { ...proof.event, value: 413 } })).hashMatches,
    ).toBe(false);
    expect(await verifyTournament(postgres.db)).toMatchObject({ passed: true, findings: [] });
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
    expect(await proof.json()).toMatchObject({
      pathMatches: true,
      event: { forecaster: { handle: "Prover", profileSlug: "Prover" } },
    });
  });
});

/**
 * A pre-013 vector event: written in the 012 shape, migrated, then proved
 * from its archived vector. It is no forecast in force and never scored.
 */
postgresDescribe(`${suiteName}: a legacy event across 013`, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!, "012_tournament_choice");
  }, 30_000);
  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  it("verifies the legacy event's hash and leaf through tournament_archived_forecast_vectors", async () => {
    const db = postgres.db;
    const user = await sql<{ id: string }>`
      insert into tournament_users default values returning id
    `.execute(db);
    const userId = user.rows[0]!.id;
    const question = await sql<{ id: string }>`
      insert into tournament_questions (
        slug, title, description_md, rulebook_md, rulebook_version, unit, bucket_count,
        opens_at, closes_at, expiry_at, status
      ) values (
        'legacy-race', 'Legacy race', 'D.', 'R.', 1, 'choice', 3,
        '2026-10-01T00:00:00Z', '2026-12-31T00:00:00Z', '2026-12-31T00:00:00Z', 'open'
      )
      returning id
    `.execute(db);
    const questionId = question.rows[0]!.id;
    for (const [index, kind, label] of [
      [0, "range", "A first"],
      [1, "range", "B first"],
      [2, "floor", "Neither"],
    ] as const) {
      await sql`
        insert into tournament_buckets (question_id, index, kind, lower, upper, label)
        values (${questionId}, ${index}, ${kind}, null, null, ${label})
      `.execute(db);
    }
    const submittedAt = "2026-10-02T12:00:00.000Z";
    const canonical = "0.2000000000,0.3000000000,0.5000000000";
    const eventHash = createHash("sha256")
      .update(questionId)
      .update(userId)
      .update(submittedAt)
      .update(canonical)
      .digest("hex");
    const event = await sql<{ id: string }>`
      insert into tournament_forecast_events (user_id, question_id, submitted_at, probs, event_hash)
      values (${userId}, ${questionId}, ${submittedAt}, '{0.2,0.3,0.5}'::numeric[], ${eventHash})
      returning id
    `.execute(db);
    const eventId = event.rows[0]!.id;

    const migration = await migrateTestDatabase(postgres, "latest");
    expect(migration.error).toBeUndefined();

    expect(await batchCompletedHours(db)).toHaveLength(1);
    const proof = await getProvenanceProof(db, eventId);
    expect(proof).toMatchObject({ hashMatches: true, pathMatches: true });
    expect(proof.event).toMatchObject({
      questionSlug: "legacy-race-v1",
      p: null,
      value: null,
      archivedProbs: [0.2, 0.3, 0.5],
      payloadCanonical: canonical,
      eventHash,
    });
    expect(await verifyProofInBrowser(proof)).toMatchObject({
      payload: canonical,
      hashMatches: true,
      rootMatches: true,
    });
    expect(await verifyTournament(db)).toMatchObject({
      passed: true,
      eventsChecked: 1,
      batchesChecked: 1,
    });
  });
});
