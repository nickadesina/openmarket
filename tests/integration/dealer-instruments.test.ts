import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DEALER_PARAMS, MODEL_VERSION } from "../../src/lib/config/dealer.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/dealer/rulebook.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { verifyDealer } from "../../src/lib/services/dealer/verify-dealer.js";
import { verifyReplay } from "../../src/lib/services/verify-replay.js";
import { insertFixtureFlags, NAMES, seedFixtureListings } from "./dealer-fixture.js";
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

  async function forwardOf(slug: string) {
    return postgres.db
      .selectFrom("instruments")
      .innerJoin("listings", "listings.id", "instruments.listing_id")
      .innerJoin("companies", "companies.id", "listings.company_id")
      .selectAll("instruments")
      .where("companies.slug", "=", slug)
      .where("instruments.kind", "=", "forward")
      .orderBy("instruments.epoch", "desc")
      .executeTakeFirstOrThrow();
  }

  async function quotesOf(instrumentId: string) {
    return postgres.db
      .selectFrom("quotes")
      .selectAll()
      .where("instrument_id", "=", instrumentId)
      .orderBy("posted_at")
      .orderBy("sequence")
      .execute();
  }

  it("widens a forward on a flag, restores it on a re-price or after 72 h", async () => {
    // Instinct listed on its Series B, so the Series C scoop and release come after.
    await seedFixtureListings(postgres.db, new Date("2026-09-01T00:00:00Z"));
    await runDealerJob(postgres.db, "s-1", new Date("2026-09-01T00:05:00Z"));
    await insertFixtureFlags(
      postgres.db,
      "instinct",
      ["scoop", "release"],
      (flag) => flag.published_at > "2026-09-01",
    );
    const forward = await forwardOf("instinct");
    const s = DEALER_PARAMS.dealer.s_floor;

    // The Sep 15 scoop widens; the mid re-centres on its $10B in the same run.
    const scoopRun = await runDealerJob(postgres.db, "s-2", new Date("2026-09-15T00:05:00Z"));
    expect(scoopRun.status === "succeeded" && scoopRun.result.steps.state.changes).toEqual([
      expect.objectContaining({ instrument_id: forward.id, from: "quoting", to: "widened" }),
    ]);
    expect(await forwardOf("instinct")).toMatchObject({
      state: "widened",
      widened_until: new Date("2026-09-18T00:00:00Z"),
    });
    let quotes = await quotesOf(forward.id);
    expect(quotes.map((quote) => quote.reason)).toEqual(["list", "widen", "requote"]);
    expect(quotes[1]).toMatchObject({ flag_state: "widened", cap_cents_effective: "1250000" });
    expect(quotes[1]!.half_spread).toBeCloseTo(3 * s, 12);
    expect(quotes[2]!.mid_ln).toBe(Math.log(10_000_000_000));

    // The next run sees a mid newer than the flag: the model has re-priced, so restore.
    await runDealerJob(postgres.db, "s-3", new Date("2026-09-15T00:20:00Z"));
    expect(await forwardOf("instinct")).toMatchObject({ state: "quoting", widened_until: null });
    quotes = await quotesOf(forward.id);
    expect(quotes.at(-1)).toMatchObject({ reason: "restore", flag_state: "normal" });
    expect(quotes.at(-1)!.half_spread).toBe(s);

    // The Sep 28 release widens and moves no forward mid, so only the 72 h hold restores it.
    await runDealerJob(postgres.db, "s-4", new Date("2026-09-28T00:05:00Z"));
    await runDealerJob(postgres.db, "s-5", new Date("2026-09-30T23:55:00Z"));
    expect(await forwardOf("instinct")).toMatchObject({ state: "widened" });
    await runDealerJob(postgres.db, "s-6", new Date("2026-10-01T00:05:00Z"));
    expect(await forwardOf("instinct")).toMatchObject({ state: "quoting" });
    quotes = await quotesOf(forward.id);
    expect(quotes.slice(-2).map((quote) => quote.reason)).toEqual(["widen", "restore"]);

    // A binary never widens.
    const binaries = await postgres.db
      .selectFrom("instruments")
      .select("state")
      .where("kind", "=", "binary")
      .execute();
    expect(new Set(binaries.map((row) => row.state))).toEqual(new Set(["quoting"]));
    expect(await verifyDealer(postgres.db)).toMatchObject({ passed: true });
  });
});
