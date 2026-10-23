import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getDealerHealth } from "../../src/lib/services/dealer/get-dealer-health.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { runSettleJob } from "../../src/lib/services/dealer/settle-instruments.js";
import { insertFixtureFlags, NAMES, seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  createTrader,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  sessionCookie,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);
vi.mock("../../src/lib/logging/server-log.js", () => ({
  logReadRequest: vi.fn(),
  logMutationRequest: vi.fn(),
  logUnexpectedError: vi.fn(),
}));

import { GET as adminDealerRoute } from "../../src/app/api/admin/dealer/route.js";

/**
 * /admin/dealer's data route (TECHNICAL_DESIGN.md §11): tournament admins
 * only; P&L, live instruments, runs, the resolution queue, source health,
 * and the widened-past-hold report the daily alert fails on.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Admin dealer PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Admin dealer PostgreSQL integration";

const LISTED_AT = new Date("2026-09-01T00:00:00.000Z");
const HOUR = 3_600_000;

function call(cookie?: string): Promise<Response> {
  return adminDealerRoute(
    new Request("https://openmkt.test/api/admin/dealer", {
      headers: cookie === undefined ? {} : { cookie },
    }),
  );
}

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
    runtime.getRuntimeDatabase.mockImplementation(() => postgres.db);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    vi.stubEnv("TOURNAMENT_ADMIN_X_IDS", "dev:dealer_admin");
    await seedFixtureListings(postgres.db, LISTED_AT);
    await runDealerJob(postgres.db, "admin-1", new Date(LISTED_AT.getTime() + 5 * 60_000));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  it("refuses anyone but a tournament admin", async () => {
    const anonymous = await call();
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).error.code).toBe("ADMIN_REQUIRED");

    const trader = await createTrader(postgres.db, "dealer_trader");
    const notAdmin = await call(await sessionCookie(postgres.db, trader.tournamentUserId));
    expect(notAdmin.status).toBe(401);
    expect((await notAdmin.json()).error.code).toBe("ADMIN_REQUIRED");
  });

  it("reports P&L, instruments, runs, the queue and empty source health to an admin", async () => {
    await runSettleJob(postgres.db, "admin-settle-1", new Date(LISTED_AT.getTime() + HOUR));
    const admin = await createTrader(postgres.db, "dealer_admin");
    const response = await call(await sessionCookie(postgres.db, admin.tournamentUserId));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();

    expect(body.pnl).toHaveLength(NAMES.length);
    for (const listing of body.pnl) {
      expect(listing.rows.map((row: { kind: string }) => row.kind).sort()).toEqual([
        "binary",
        "forward",
      ]);
      expect(listing.totals).toMatchObject({
        realised_cents: "0",
        open_collateral_cents: "0",
        live_bound_cents: expect.stringMatching(/^\d+$/),
      });
    }
    expect(body.instruments).toHaveLength(NAMES.length * 2);
    expect(body.cron_runs.map((entry: { job: string }) => entry.job)).toEqual([
      "ingest",
      "dealer",
      "settle",
    ]);
    const dealerRuns = body.cron_runs.find((entry: { job: string }) => entry.job === "dealer");
    expect(dealerRuns.runs).toEqual([
      expect.objectContaining({ run_id: "admin-1", status: "succeeded", error: null }),
    ]);
    expect(body.resolution_queue).toMatchObject({ run_id: "admin-settle-1", pending: [] });
    expect(body.sources).toEqual([]);
    expect(body.health.widened_over_hold).toEqual({ hold_hours: 72, instruments: [] });
  });

  it("reads the queue from the latest settle run's pending promotions", async () => {
    const [release] = await insertFixtureFlags(
      postgres.db,
      "instinct",
      ["release"],
      (flag) => flag.published_at === "2026-09-28",
    );
    const flag = await postgres.db
      .selectFrom("event_flags")
      .select(["id", "observed_at"])
      .where("dedupe_key", "=", release!.dedupe_key)
      .executeTakeFirstOrThrow();
    // A run that left the release for review, as the settle job records one in its detail.
    await postgres.db
      .insertInto("cron_runs")
      .values({
        job: "settle",
        run_id: "admin-settle-queue",
        status: "succeeded",
        started_at: new Date(LISTED_AT.getTime() + 2 * HOUR),
        finished_at: new Date(LISTED_AT.getTime() + 2 * HOUR + 1_000),
        detail_json: JSON.stringify({
          pending: [
            {
              flag_id: flag.id,
              company: "Instinct",
              kind: "release",
              source_rank: 3,
              confidence: "high",
              reason: "rank_needs_review",
            },
          ],
        }),
      })
      .execute();
    const admin = await createTrader(postgres.db, "dealer_admin");
    const body = await (
      await call(await sessionCookie(postgres.db, admin.tournamentUserId))
    ).json();
    expect(body.resolution_queue).toMatchObject({
      run_id: "admin-settle-queue",
      pending: [
        {
          flag_id: flag.id,
          reason: "rank_needs_review",
          observed_at: flag.observed_at.toISOString(),
          promoted_since: false,
        },
      ],
    });
  });

  it("reports a forward widened past the 72 h hold", async () => {
    // Instinct's Sep 28 release widens its forward and moves no mid, so only the hold restores it.
    await insertFixtureFlags(
      postgres.db,
      "instinct",
      ["release"],
      (flag) => flag.published_at === "2026-09-28",
    );
    const widenedAt = new Date("2026-09-28T00:05:00.000Z");
    await runDealerJob(postgres.db, "admin-widen", widenedAt);

    const within = await getDealerHealth(postgres.db, new Date(widenedAt.getTime() + 71 * HOUR));
    expect(within.instruments_widened).toBe(1);
    expect(within.widened_over_hold.instruments).toEqual([]);

    // The dealer job stopped running: nothing restored it, and the alert sees it.
    const past = await getDealerHealth(postgres.db, new Date(widenedAt.getTime() + 73 * HOUR));
    expect(past.widened_over_hold.instruments).toEqual([
      expect.objectContaining({
        company: "Instinct",
        kind: "forward",
        widened_since: widenedAt,
      }),
    ]);
    expect(past.widened_over_hold.instruments[0]!.hours_widened).toBeCloseTo(73, 9);
  });
});
