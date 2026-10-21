import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DEALER_PARAMS, MODEL_VERSION } from "../../src/lib/config/dealer.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/dealer/rulebook.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { verifyDealer } from "../../src/lib/services/dealer/verify-dealer.js";
import { verifyReplay } from "../../src/lib/services/verify-replay.js";
import { NAMES, seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * The dealer job lists, re-states and quotes the five names (milestone 6
 * gate: "five names quoting"). Times are passed in, so each scenario runs on
 * the fixture's calendar rather than the wall clock.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Dealer instruments PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Dealer instruments PostgreSQL integration";

const LISTED_AT = new Date("2026-10-20T00:00:00.000Z");

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
  });

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  it("lists ten instruments on five names and quotes both kinds", async () => {
    await seedFixtureListings(postgres.db, LISTED_AT);
    const now = new Date("2026-10-20T00:05:00.000Z");
    const outcome = await runDealerJob(postgres.db, "list-1", now);
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    expect(outcome.result.steps.list.listed).toHaveLength(10);
    expect(outcome.result.steps.mids).toMatchObject({ instruments: 10, mids_written: 0 });

    const db = postgres.db;
    const instruments = await db
      .selectFrom("instruments")
      .innerJoin("listings", "listings.id", "instruments.listing_id")
      .innerJoin("companies", "companies.id", "listings.company_id")
      .innerJoin("markets", "markets.instrument_id", "instruments.id")
      .select([
        "companies.name",
        "instruments.id",
        "instruments.kind",
        "instruments.epoch",
        "instruments.state",
        "instruments.question",
        "instruments.opens_at",
        "instruments.expires_at",
        "instruments.entry_ref_ln",
        "listings.anchor_post_money_usd",
        "listings.forward_t_days",
        "markets.metric_kind",
        "markets.q",
        "markets.b",
        "markets.current_metric",
        "markets.status",
      ])
      .orderBy("companies.name")
      .orderBy("instruments.kind")
      .execute();
    expect(instruments.map((row) => row.name)).toEqual(
      [...NAMES].sort().flatMap((name) => [name, name]),
    );
    for (const row of instruments) {
      expect(row).toMatchObject({ epoch: 1, state: "quoting", status: "open" });
      expect(row.opens_at).toEqual(now);
      if (row.kind === "binary") {
        expect(row).toMatchObject({ metric_kind: "yes_probability", b: 2000, entry_ref_ln: null });
        expect(row.expires_at.toISOString()).toBe("2026-12-31T23:59:59.999Z");
      } else {
        expect(row).toMatchObject({ metric_kind: "forward_ln", b: 1, q: [0, 0] });
        expect(row.entry_ref_ln).toBe(Math.log(Number(row.anchor_post_money_usd)));
        expect(row.expires_at.getTime() - now.getTime()).toBe(row.forward_t_days * 86_400_000);
        expect(row.question).toBe(`What will ${row.name}'s next post-money valuation be?`);
      }
    }
    const openai = instruments.find((row) => row.name === "OpenAI" && row.kind === "binary")!;
    expect(openai.question).toBe("Will OpenAI publicly file an S-1 by 2026-12-31?");
    const modal = instruments.find((row) => row.name === "Modal" && row.kind === "binary")!;
    expect(modal.question).toBe("Will Modal announce a priced round by 2026-12-31?");

    const quotes = await db.selectFrom("quotes").selectAll().orderBy("instrument_id").execute();
    expect(quotes).toHaveLength(10);
    for (const quote of quotes) {
      const instrument = instruments.find((row) => row.id === quote.instrument_id)!;
      expect(quote).toMatchObject({
        reason: "list",
        flag_state: "normal",
        inventory_cents: "0",
        model_version: MODEL_VERSION,
        rulebook_version: RULEBOOK_VERSION,
      });
      if (instrument.kind === "binary") {
        expect(quote.price).toBe(instrument.current_metric);
        expect(quote.mid_ln).toBeNull();
      } else {
        const s = DEALER_PARAMS.dealer.s_floor;
        expect(quote.mid_ln).toBe(Math.log(instrument.current_metric));
        expect(quote.half_spread).toBe(s);
        expect(quote.bid_ln).toBeCloseTo(quote.mid_ln! - s, 12);
        expect(quote.ask_ln).toBeCloseTo(quote.mid_ln! + s, 12);
        expect(quote.cap_cents_effective).toBe("2500000");
      }
    }

    const rerun = await runDealerJob(postgres.db, "list-2", new Date("2026-10-20T00:20:00Z"));
    expect(rerun.status === "succeeded" && rerun.result.steps.list.listed).toEqual([]);
    expect(await db.selectFrom("instruments").select("id").execute()).toHaveLength(10);

    expect((await verifyReplay(db)).passed).toBe(true);
    expect(await verifyDealer(db)).toMatchObject({ passed: true, findings: [] });
  });
});
