import { readFileSync } from "node:fs";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEALER_PARAMS, MODEL_VERSION } from "../../src/lib/config/dealer.js";
import { EVENTS_CSV_PATH, listingAnchors } from "../../src/lib/config/listing-anchors.js";
import { binaryExpiry, RULEBOOK_VERSION } from "../../src/lib/engine/dealer/rulebook.js";
import { runCronJob } from "../../src/lib/services/dealer/cron-run.js";
import { seedListings } from "../../src/lib/services/dealer/seed-listings.js";
import { verifyDealer } from "../../src/lib/services/dealer/verify-dealer.js";
import { fixtureFlagsFor, utcDay } from "../services/event-flags-fixture.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);

import { GET as dealerRoute } from "../../src/app/api/cron/dealer/route.js";

/**
 * The mid step of /api/cron/dealer against PostgreSQL. Listings come from
 * the seed service with tests/fixtures/listing-sources.csv; Anthropic's
 * anchor is its Series G (events.csv without the Series H row), so the
 * fixture's Series H scoop and release are flags since the anchor.
 * Instruments are inserted by hand; tests/integration/dealer-instruments.test.ts
 * covers the list step.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Dealer mids PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Dealer mids PostgreSQL integration";

const SECRET = "a-long-enough-cron-secret";
const NAMES = Object.keys(DEALER_PARAMS.forward_t_days);
const EVENTS = readFileSync(EVENTS_CSV_PATH, "utf8");
const SOURCES = readFileSync("tests/fixtures/listing-sources.csv", "utf8");
// After the wall clock, so the dealer job's list step (listings listed by now) leaves this
// test's hand-made instruments the only live ones.
const LISTED_AT = new Date("2030-01-01T00:00:00.000Z");
const WITHOUT_SERIES_H = EVENTS.split("\n")
  .filter((line) => !line.startsWith("Anthropic,priced_round,Series H,"))
  .join("\n");
const SERIES_G = listingAnchors(WITHOUT_SERIES_H, SOURCES, ["Anthropic"])[0]!;
const ANCHORS = listingAnchors(EVENTS, SOURCES, NAMES).map((anchor) =>
  anchor.company === "Anthropic" ? SERIES_G : anchor,
);

function call(headers: Record<string, string>): Promise<Response> {
  return dealerRoute(new Request("https://t.test/api/cron/dealer", { headers }));
}

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;
  let instrumentIds: { binary: string; forward: string };

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
    runtime.getRuntimeDatabase.mockImplementation(() => postgres.db);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    const results = await seedListings(postgres.db, {
      listedAt: LISTED_AT,
      relist: false,
      anchors: ANCHORS,
    });
    const anthropic = results.find((result) => result.company.slug === "anthropic")!;
    expect(anthropic.listing).toMatchObject({ anchor_round: "Series G", tier: "mega" });

    const db = postgres.db;
    const binary = await db
      .insertInto("instruments")
      .values({
        listing_id: anthropic.listing.id,
        kind: "binary",
        epoch: 1,
        question: "Will Anthropic publicly file an S-1 by 2030-03-31?",
        opens_at: LISTED_AT,
        expires_at: binaryExpiry(LISTED_AT),
        state: "quoting",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const forward = await db
      .insertInto("instruments")
      .values({
        listing_id: anthropic.listing.id,
        kind: "forward",
        epoch: 1,
        question: "Anthropic's next priced-round post-money",
        opens_at: LISTED_AT,
        expires_at: new Date(LISTED_AT.getTime() + anthropic.listing.forward_t_days * 86_400_000),
        entry_ref_ln: Math.log(Number(SERIES_G.postMoneyUsd)),
        state: "quoting",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    instrumentIds = { binary: binary.id, forward: forward.id };
    const book = {
      company_id: anthropic.company.id,
      status: "open" as const,
      n_buckets: 2,
      sigma: null,
      initial_q: [0, 0],
      q: [0, 0],
    };
    await db
      .insertInto("markets")
      .values([
        {
          ...book,
          instrument_id: binary.id,
          bucket_grid_version: "binary-v1",
          metric_kind: "yes_probability",
          b: Number(anthropic.listing.b_cents) / 100,
          current_metric: 0.5,
        },
        {
          ...book,
          instrument_id: forward.id,
          bucket_grid_version: "forward-v1",
          metric_kind: "forward_ln",
          b: anthropic.listing.kappa,
          current_metric: Number(SERIES_G.postMoneyUsd),
        },
      ])
      .execute();

    const flags = fixtureFlagsFor("anthropic", ["scoop", "release"]);
    await db
      .insertInto("event_flags")
      .values(
        flags.map((flag) => ({
          company_id: anthropic.company.id,
          kind: flag.kind,
          source_url: flag.source_url,
          source_rank: flag.source_rank,
          observed_at: utcDay(flag.observed_at),
          published_at: utcDay(flag.published_at),
          terms_json: flag.terms,
          confidence: flag.confidence,
          dedupe_key: flag.dedupe_key,
        })),
      )
      .execute();
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  async function mids() {
    return postgres.db
      .selectFrom("model_mids")
      .selectAll()
      .orderBy("computed_at")
      .orderBy("instrument_id")
      .execute();
  }

  it("writes one mid per live instrument, once per run id, and replays", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const headers = { authorization: `Bearer ${SECRET}`, "x-run-id": "18234567890-1" };
    const first = await call(headers);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body).toMatchObject({
      run_id: "18234567890-1",
      status: "succeeded",
      instruments: 2,
      mids_written: 2,
      health: { instruments_quoting: 2, instruments_widened: 0, instruments_without_mid: 0 },
    });

    const written = await mids();
    expect(written).toHaveLength(2);
    const byInstrument = new Map(written.map((row) => [row.instrument_id, row]));
    const binary = byInstrument.get(instrumentIds.binary)!;
    const forward = byInstrument.get(instrumentIds.forward)!;
    // The Series H release (2026-05-28) precedes listing by far more than 60 days.
    expect(binary).toMatchObject({
      p: DEALER_PARAMS.prior.leak_hazard_far,
      mid_ln: null,
      model_version: MODEL_VERSION,
      rulebook_version: RULEBOOK_VERSION,
      run_id: "18234567890-1",
      inputs_json: { kind: "binary", leak: { kind: "release" }, note: expect.any(String) },
    });
    // Re-centred on the Series H scoop's $930B.
    expect(forward).toMatchObject({ p: null, run_id: "18234567890-1" });
    expect(forward.mid_ln).toBe(Math.log(930_000_000_000));

    const run = await postgres.db
      .selectFrom("cron_runs")
      .selectAll()
      .where("run_id", "=", "18234567890-1")
      .executeTakeFirstOrThrow();
    expect(run).toMatchObject({
      job: "dealer",
      status: "succeeded",
      detail_json: { mids_written: 2 },
    });
    expect(run.finished_at).not.toBeNull();

    const rerun = await call(headers);
    expect(rerun.status).toBe(200);
    expect(await rerun.json()).toMatchObject({
      run_id: "18234567890-1",
      status: "already_ran",
      previous: { job: "dealer", status: "succeeded" },
    });
    expect(await mids()).toHaveLength(2);

    const next = await call({ ...headers, "x-run-id": "18234567891-1" });
    expect(await next.json()).toMatchObject({ status: "succeeded", mids_written: 0 });
    const generated = await call({ authorization: `Bearer ${SECRET}` });
    expect(await generated.json()).toMatchObject({
      run_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      mids_written: 0,
    });
    expect(await mids()).toHaveLength(2);

    expect(await verifyDealer(postgres.db)).toEqual({ midsChecked: 2, findings: [], passed: true });
  });

  it("refuses a missing or wrong secret before claiming the run", async () => {
    const unconfigured = await call({ authorization: `Bearer ${SECRET}` });
    expect(unconfigured.status).toBe(401);
    vi.stubEnv("CRON_SECRET", SECRET);
    const wrong = await call({ authorization: "Bearer not-the-cron-secret", "x-run-id": "1-1" });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: { code: "ADMIN_REQUIRED" } });
    const badId = await call({ authorization: `Bearer ${SECRET}`, "x-run-id": "not a run id" });
    expect(badId.status).toBe(400);
    expect(await postgres.db.selectFrom("cron_runs").select("id").execute()).toEqual([]);
  });

  it("marks a failed run and keeps none of its writes", async () => {
    await expect(
      runCronJob(postgres.db, "dealer", "failing-1", async (transaction, runId) => {
        await transaction
          .insertInto("cron_runs")
          .values({ job: "dealer", run_id: `${runId}-inner`, status: "running" })
          .execute();
        throw new Error("step exploded");
      }),
    ).rejects.toThrow("step exploded");
    const runs = await postgres.db.selectFrom("cron_runs").selectAll().execute();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      run_id: "failing-1",
      status: "failed",
      detail_json: { error: "step exploded" },
    });
  });

  it("flags a stored mid its inputs do not recompute", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    await call({ authorization: `Bearer ${SECRET}`, "x-run-id": "2-1" });
    const forward = (await mids()).find((row) => row.instrument_id === instrumentIds.forward)!;
    await postgres.db
      .insertInto("model_mids")
      .values({
        instrument_id: forward.instrument_id,
        model_version: forward.model_version,
        rulebook_version: forward.rulebook_version,
        computed_at: new Date(),
        mid_ln: forward.mid_ln! + 1e-9,
        p: null,
        inputs_json: JSON.stringify(forward.inputs_json),
        run_id: null,
      })
      .execute();
    const report = await verifyDealer(postgres.db);
    expect(report).toMatchObject({ midsChecked: 3, passed: false });
    expect(report.findings).toHaveLength(1);
  });
});
