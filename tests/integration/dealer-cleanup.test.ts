import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "kysely";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { requireCronSecret } from "../../src/lib/auth/cron.js";
import { beginCronRun, runCronJob } from "../../src/lib/services/dealer/cron-run.js";
import { getDealerAdmin } from "../../src/lib/services/dealer/get-dealer-admin.js";
import {
  getInstrumentQuote,
  loadInstrumentBook,
} from "../../src/lib/services/dealer/get-instrument-quote.js";
import { loadRefListing } from "../../src/lib/services/dealer/ref-common.js";
import { requote } from "../../src/lib/services/dealer/requote.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { runSettleJob } from "../../src/lib/services/dealer/settle-instruments.js";
import { settleLmsrBook } from "../../src/lib/services/dealer/settle-lmsr-book.js";
import { verifyDealer } from "../../src/lib/services/dealer/verify-dealer.js";
import { voidQuestion } from "../../src/lib/services/tournament/admin.js";
import { insertUser, seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  testDatabaseUrl,
} from "./postgres.js";

const databaseUrl = testDatabaseUrl();
const LISTED = new Date("2026-09-01T00:00:00Z");
const NOW = new Date("2026-09-02T00:00:00Z");
(databaseUrl ? describe : describe.skip)("dealer cleanup regressions", () => {
  let postgres: PostgresTestDatabase;
  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);
  beforeEach(async () => {
    vi.stubEnv("TOURNAMENT_LINKED_QUESTIONS", "1");
    await resetPostgresTestDatabase(postgres.db);
    await seedFixtureListings(postgres.db, LISTED);
    await runDealerJob(postgres.db, "initial", LISTED);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await postgres?.dispose();
  });

  it("identifies cron authentication failures separately from admin access", () => {
    expect(() =>
      requireCronSecret(new Request("https://example.test/api/cron/dealer"), "dealer"),
    ).toThrow(expect.objectContaining({ code: "CRON_UNAUTHORIZED" }));
  });

  it("identifies missing listings separately from markets", async () => {
    await expect(loadRefListing(postgres.db, "missing-listing")).rejects.toMatchObject({
      code: "LISTING_NOT_FOUND",
    });
  });

  it("identifies missing instruments separately from markets", async () => {
    await expect(loadInstrumentBook(postgres.db, randomUUID())).rejects.toMatchObject({
      code: "INSTRUMENT_NOT_FOUND",
    });
  });

  it("replays a published crowd reference after its question is voided and relinked", async () => {
    const link = await postgres.db
      .selectFrom("tournament_instrument_links")
      .innerJoin(
        "tournament_questions",
        "tournament_questions.id",
        "tournament_instrument_links.question_id",
      )
      .select(["tournament_questions.id", "tournament_questions.slug", "instrument_id"])
      .where("tournament_questions.kind", "=", "binary")
      .executeTakeFirstOrThrow();
    await postgres.db
      .insertInto("tournament_aggregates")
      .values({
        question_id: link.id,
        computed_at: NOW,
        n_forecasters: 12,
        p: "0.7",
        value: null,
        extremization: 1,
        weighting_version: "test",
      })
      .execute();
    await runDealerJob(postgres.db, "crowd", NOW);
    expect((await verifyDealer(postgres.db)).findings).toEqual([]);
    await voidQuestion(postgres.db, link.slug, { note_md: "Regression test void." });
    await runDealerJob(postgres.db, "relink", new Date(NOW.getTime() + 60_000));
    expect((await verifyDealer(postgres.db)).findings).toEqual([]);
  });

  it("continues settling later instruments after one fails, and records a failed run", async () => {
    const first = await postgres.db
      .selectFrom("instruments")
      .selectAll()
      .orderBy("listing_id")
      .orderBy("kind")
      .executeTakeFirstOrThrow();
    await sql`create function fail_one_settlement() returns trigger language plpgsql as $$ begin if NEW.id = '${sql.raw(first.id)}'::uuid and NEW.closed_at is not null then raise exception 'injected settlement failure'; end if; return NEW; end $$`.execute(
      postgres.db,
    );
    await sql`create trigger fail_one_settlement before update on instruments for each row execute function fail_one_settlement()`.execute(
      postgres.db,
    );
    try {
      await expect(
        runSettleJob(postgres.db, "partial", new Date("2026-10-02T01:00:00Z")),
      ).rejects.toThrow();
      const resolved = await postgres.db
        .selectFrom("instruments")
        .select("id")
        .where("state", "=", "expired")
        .execute();
      expect(resolved).toHaveLength(4);
      const run = await postgres.db
        .selectFrom("cron_runs")
        .selectAll()
        .where("run_id", "=", "partial")
        .executeTakeFirstOrThrow();
      expect(run.status).toBe("failed");
      expect(run.detail_json).toMatchObject({
        error: expect.stringContaining("injected settlement failure"),
        failures: [
          {
            instrument_id: first.id,
            error: expect.stringContaining("injected settlement failure"),
          },
        ],
      });
    } finally {
      await sql`drop trigger fail_one_settlement on instruments`.execute(postgres.db);
      await sql`drop function fail_one_settlement()`.execute(postgres.db);
    }
  });

  it("rejects a second print promoted from the same source", async () => {
    const company = await postgres.db
      .selectFrom("companies")
      .select("id")
      .executeTakeFirstOrThrow();
    const source = await postgres.db
      .insertInto("event_flags")
      .values({
        company_id: company.id,
        kind: "release",
        observed_at: NOW,
        terms_json: {},
        confidence: "high",
        dedupe_key: "source",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const print = {
      company_id: company.id,
      kind: "print" as const,
      observed_at: NOW,
      terms_json: {},
      confidence: "high" as const,
      source_rank: 1,
      source_url: "https://example.test/source",
      promoted_from: source.id,
    };
    await postgres.db
      .insertInto("event_flags")
      .values({ ...print, dedupe_key: "print-one" })
      .execute();
    await expect(
      postgres.db
        .insertInto("event_flags")
        .values({ ...print, dedupe_key: "print-two" })
        .execute(),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rolls back settlement when the book is no longer open", async () => {
    const market = await postgres.db
      .selectFrom("markets")
      .selectAll()
      .where("metric_kind", "=", "yes_probability")
      .executeTakeFirstOrThrow();
    await postgres.db
      .updateTable("markets")
      .set({ status: "settled", settled_at: NOW })
      .where("id", "=", market.id)
      .execute();
    await expect(
      postgres.db.transaction().execute((tx) =>
        settleLmsrBook(tx, {
          market: { ...market, market_id: market.id },
          winningBucket: 0,
          settledValue: "0.00",
          sourceUrl: "https://example.test/source",
          sourceDescription: null,
          ts: NOW,
        }),
      ),
    ).rejects.toThrow();
    expect(
      await postgres.db
        .selectFrom("settlements")
        .selectAll()
        .where("market_id", "=", market.id)
        .execute(),
    ).toEqual([]);
  });

  it("takes the listing lock before instrument locks in both overlapping jobs", async () => {
    const first = await postgres.db
      .selectFrom("instruments")
      .selectAll()
      .orderBy("listing_id")
      .orderBy("kind")
      .executeTakeFirstOrThrow();
    const blocker = new Client({ connectionString: postgres.connectionString });
    const observer = new Client({ connectionString: postgres.connectionString });
    await blocker.connect();
    await observer.connect();
    await blocker.query("begin");
    await blocker.query(
      "select pg_advisory_xact_lock(hashtext('openmarket_listing'), hashtext($1))",
      [first.listing_id],
    );
    const settling = runSettleJob(
      postgres.db,
      "concurrent-settle",
      new Date("2026-10-02T01:00:00Z"),
    );
    const dealing = runDealerJob(
      postgres.db,
      "concurrent-dealer",
      new Date("2026-10-02T01:00:00Z"),
    );
    try {
      let waiting = 0;
      for (let i = 0; i < 100; i += 1) {
        const result = await observer.query(
          "select count(*)::int n from pg_stat_activity where application_name = $1 and wait_event = 'advisory'",
          [postgres.applicationName],
        );
        waiting = result.rows[0].n;
        if (waiting >= 2) break;
        await delay(10);
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
      // Neither job may hold any instrument while it waits on the listing.
      await observer.query("begin");
      await observer.query("select id from instruments for update nowait");
      await observer.query("rollback");
    } finally {
      await observer.query("rollback");
      await blocker.query("rollback");
      await blocker.end();
      await observer.end();
      await Promise.all([settling, dealing]);
    }
    expect((await verifyDealer(postgres.db)).findings).toEqual([]);
  });

  it("preserves the original job failure when failure bookkeeping also fails", async () => {
    await sql`create function fail_cron_finish() returns trigger language plpgsql as $$ begin if NEW.status = 'failed' then raise exception 'bookkeeping failed'; end if; return NEW; end $$`.execute(
      postgres.db,
    );
    await sql`create trigger fail_cron_finish before update on cron_runs for each row execute function fail_cron_finish()`.execute(
      postgres.db,
    );
    const original = new Error("original job failure");
    try {
      await expect(
        runCronJob(postgres.db, "dealer", "double-failure", async () => {
          throw original;
        }),
      ).rejects.toBe(original);
    } finally {
      await sql`drop trigger fail_cron_finish on cron_runs`.execute(postgres.db);
      await sql`drop function fail_cron_finish()`.execute(postgres.db);
    }
  });

  it("publishes version identifiers with admin dealer figures", async () => {
    expect(await getDealerAdmin(postgres.db, NOW)).toMatchObject({
      model_version: expect.any(String),
      rulebook_version: expect.any(String),
      blend_version: expect.any(String),
    });
  });

  it("classifies corrupt stored holdings as an internal failure", async () => {
    const market = await postgres.db
      .selectFrom("markets")
      .selectAll()
      .where("metric_kind", "=", "yes_probability")
      .executeTakeFirstOrThrow();
    const userId = await insertUser(postgres.db, "corrupt-holdings");
    await postgres.db
      .insertInto("holdings")
      .values({ user_id: userId, market_id: market.id, h: [1], updated_at: NOW })
      .execute();
    await expect(
      postgres.db.transaction().execute((tx) =>
        settleLmsrBook(tx, {
          market: { ...market, market_id: market.id },
          winningBucket: 0,
          settledValue: "0.00",
          sourceUrl: "https://example.test/source",
          sourceDescription: null,
          ts: NOW,
        }),
      ),
    ).rejects.toMatchObject({
      name: "Error",
      message: "Stored holdings do not match the market bucket count.",
    });
  });

  it("marks abandoned runs failed when the next run claims", async () => {
    await postgres.db
      .insertInto("cron_runs")
      .values({
        job: "dealer",
        run_id: "abandoned",
        status: "running",
        started_at: new Date(Date.now() - 3_600_000),
      })
      .execute();
    await beginCronRun(postgres.db, "dealer", "next");
    const old = await postgres.db
      .selectFrom("cron_runs")
      .selectAll()
      .where("run_id", "=", "abandoned")
      .executeTakeFirstOrThrow();
    expect(old.status).toBe("failed");
    expect(old.finished_at).not.toBeNull();
  });

  it("posts the same normal spread that a live fill sees after widening expires", async () => {
    const forward = await postgres.db
      .selectFrom("instruments")
      .selectAll()
      .where("kind", "=", "forward")
      .executeTakeFirstOrThrow();
    await postgres.db
      .updateTable("instruments")
      .set({ state: "widened", widened_until: NOW })
      .where("id", "=", forward.id)
      .execute();
    await postgres.db.transaction().execute((tx) => requote(tx, NOW));
    const quote = await getInstrumentQuote(postgres.db, forward.id, {}, NOW);
    const posted = await postgres.db
      .selectFrom("quotes")
      .selectAll()
      .where("instrument_id", "=", forward.id)
      .orderBy("sequence", "desc")
      .executeTakeFirstOrThrow();
    expect(posted.flag_state).toBe("normal");
    if (quote.kind !== "forward") throw new Error("expected forward");
    expect(posted.bid_ln).toBe(quote.bid_ln);
    expect(posted.ask_ln).toBe(quote.ask_ln);
  });
});
