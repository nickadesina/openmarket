import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MODEL_VERSION } from "../../src/lib/config/dealer.js";
import { BLEND_SCHEDULE, BLEND_VERSION } from "../../src/lib/engine/dealer/blend.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/dealer/rulebook.js";
import { executeForwardTrade } from "../../src/lib/services/dealer/execute-forward-trade.js";
import { getInstrumentQuote } from "../../src/lib/services/dealer/get-instrument-quote.js";
import type { ReferenceComponents } from "../../src/lib/services/dealer/reference-prices.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { verifyDealer } from "../../src/lib/services/dealer/verify-dealer.js";
import { executeTrade } from "../../src/lib/services/execute-trade.js";
import { saveDraftQuestion } from "../../src/lib/services/tournament/admin.js";
import { insertUser, NAMES, seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * The dealer job's reference step (README D14): one blended row per listing
 * and kind, written only when it moves, and recomputed by verify:replay.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Dealer reference PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Dealer reference PostgreSQL integration";

const LISTED_AT = new Date("2026-10-20T00:00:00.000Z");
const RUN_AT = new Date("2026-10-20T00:05:00.000Z");
const TRADE_AT = new Date("2026-10-20T01:00:00.000Z");
const LATER = new Date("2026-10-20T01:05:00.000Z");
const HOUR = 3_600_000;

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    await seedFixtureListings(postgres.db, LISTED_AT);
    await runDealerJob(postgres.db, "reference-1", RUN_AT);
  });

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  async function instrumentOf(slug: string, kind: "binary" | "forward") {
    return postgres.db
      .selectFrom("instruments")
      .innerJoin("listings", "listings.id", "instruments.listing_id")
      .innerJoin("companies", "companies.id", "listings.company_id")
      .innerJoin("markets", "markets.instrument_id", "instruments.id")
      .selectAll("instruments")
      .select(["markets.id as market_id"])
      .where("companies.slug", "=", slug)
      .where("instruments.kind", "=", kind)
      .orderBy("instruments.epoch", "desc")
      .executeTakeFirstOrThrow();
  }

  async function referencesOf(listingId: string, kind: "binary" | "forward") {
    return postgres.db
      .selectFrom("reference_prices")
      .selectAll()
      .where("listing_id", "=", listingId)
      .where("kind", "=", kind)
      .orderBy("as_of")
      .execute();
  }

  async function latestMidOf(instrumentId: string) {
    return postgres.db
      .selectFrom("model_mids")
      .selectAll()
      .where("instrument_id", "=", instrumentId)
      .orderBy("computed_at", "desc")
      .executeTakeFirstOrThrow();
  }

  async function linkQuestion(
    instrumentId: string,
    unit: "bool" | "USD_B",
    aggregate: { n: number; pYes?: number; medianB?: number },
  ) {
    const slug = `ref-${randomUUID().slice(0, 8)}`;
    const opensAt = new Date(LISTED_AT.getTime() - HOUR);
    const closesAt = new Date(LISTED_AT.getTime() + 90 * 24 * HOUR);
    const saved = await saveDraftQuestion(
      postgres.db,
      unit === "bool"
        ? {
            slug,
            title: "Linked binary",
            description_md: "Description.",
            rulebook_md: "Rulebook.",
            rulebook_version: 1,
            unit,
            opens_at: opensAt.toISOString(),
            closes_at: closesAt.toISOString(),
          }
        : {
            slug,
            title: "Linked ladder",
            description_md: "Description.",
            rulebook_md: "Rulebook.",
            rulebook_version: 1,
            unit,
            opens_at: opensAt.toISOString(),
            closes_at: closesAt.toISOString(),
            expiry_at: closesAt.toISOString(),
            buckets: { edges: [5, 10, 20, 40], floor_label: "Nothing by expiry" },
          },
    );
    const question = await postgres.db
      .selectFrom("tournament_questions")
      .select("id")
      .where("slug", "=", saved.slug)
      .executeTakeFirstOrThrow();
    await postgres.db
      .insertInto("tournament_instrument_links")
      .values({ question_id: question.id, instrument_id: instrumentId })
      .execute();
    await postgres.db
      .insertInto("tournament_aggregates")
      .values({
        question_id: question.id,
        computed_at: TRADE_AT,
        probs: unit === "bool" ? ["0.3", "0.7"] : ["0.1", "0.2", "0.4", "0.2", "0.1"],
        n_forecasters: aggregate.n,
        median_value: aggregate.medianB === undefined ? null : String(aggregate.medianB),
        p_floor: unit === "bool" ? null : "0.1",
        p_yes: aggregate.pYes === undefined ? null : String(aggregate.pYes),
        extremization: 1,
        weighting_version: "test",
      })
      .execute();
    return question.id;
  }

  it("publishes the model mid as the reference when there is no flow and no crowd", async () => {
    const rows = await postgres.db.selectFrom("reference_prices").selectAll().execute();
    expect(rows).toHaveLength(NAMES.length * 2);
    for (const row of rows) {
      expect(row).toMatchObject({
        blend_version: BLEND_VERSION,
        model_version: MODEL_VERSION,
        rulebook_version: RULEBOOK_VERSION,
        w_model: 1,
        w_traded: 0,
        w_crowd: 0,
      });
      const components = row.components_json as unknown as ReferenceComponents;
      const mid = await latestMidOf(components.instrument_id);
      expect(components.model.model_mid_id).toBe(mid.id);
      expect(row.value).toBe(row.kind === "forward" ? mid.mid_ln : mid.p);
      expect(components.traded).toMatchObject({ trades: 0, volume_usd: 0, value: null });
      expect(components.crowd).toBeNull();
      expect(components.schedule).toEqual(BLEND_SCHEDULE);
    }

    // Nothing moved: a second run appends nothing.
    const again = await runDealerJob(postgres.db, "reference-2", LATER);
    expect(again.status).toBe("succeeded");
    if (again.status === "succeeded") {
      expect(again.result.steps.reference.written).toEqual([]);
      expect(again.result.steps.reference.unchanged).toBe(NAMES.length * 2);
    }
    expect(await postgres.db.selectFrom("reference_prices").selectAll().execute()).toHaveLength(
      NAMES.length * 2,
    );

    const verification = await verifyDealer(postgres.db);
    expect(verification.findings).toEqual([]);
    expect(verification.referencesChecked).toBe(NAMES.length * 2);
  });

  it("weights the forward's traded entry by notional and the binary's fills by cash", async () => {
    const userId = await insertUser(postgres.db, "reference-trader");
    const forward = await instrumentOf("modal", "forward");
    const quote = await getInstrumentQuote(postgres.db, forward.id, {}, TRADE_AT);
    if (quote.kind !== "forward") throw new Error("expected a forward quote");
    const long = await executeForwardTrade(
      postgres.db,
      userId,
      {
        idempotency_key: randomUUID(),
        instrument_id: forward.id,
        side: "long",
        notional_usd: "10000.00",
        max_entry_ln: quote.ask_ln,
      },
      { now: TRADE_AT },
    );

    const binary = await instrumentOf("modal", "binary");
    const bought = await executeTrade(
      postgres.db,
      userId,
      {
        market_id: binary.market_id,
        action: "buy",
        side: "yes",
        strike_index: 0,
        quantity: 100,
        idempotency_key: randomUUID(),
        max_cost_usd: "100.00",
      },
      { now: TRADE_AT },
    );

    await runDealerJob(postgres.db, "reference-3", LATER);

    const forwardRows = await referencesOf(forward.listing_id, "forward");
    expect(forwardRows).toHaveLength(2);
    const forwardRef = forwardRows.at(-1)!;
    const forwardComponents = forwardRef.components_json as unknown as ReferenceComponents;
    expect(forwardComponents.traded).toMatchObject({
      weighting: "notional_entry_ln",
      trades: 1,
      volume_usd: 10_000,
      value: long.result.entry_ln,
    });
    const wTraded = 10_000 / (10_000 + BLEND_SCHEDULE.traded.v0_usd);
    expect(forwardRef.w_traded).toBeCloseTo(wTraded, 15);
    expect(forwardRef.w_crowd).toBe(0);
    expect(forwardRef.value).toBeCloseTo(
      (1 - wTraded) * forwardComponents.model.value + wTraded * long.result.entry_ln,
      12,
    );

    const binaryRef = (await referencesOf(binary.listing_id, "binary")).at(-1)!;
    const binaryComponents = binaryRef.components_json as unknown as ReferenceComponents;
    const cash = Number(bought.result.cash_amount_cents);
    expect(binaryComponents.traded).toMatchObject({
      weighting: "cash_yes_price",
      trades: 1,
      volume_usd: cash / 100,
    });
    expect(binaryComponents.traded.value).toBeCloseTo(cash / 100 / 100, 15);
    expect(binaryRef.w_traded).toBeCloseTo(cash / 100 / (cash / 100 + 50_000), 15);

    const verification = await verifyDealer(postgres.db);
    expect(verification.findings).toEqual([]);
  });

  it("gives a linked crowd weight only from ten forecasters", async () => {
    const binary = await instrumentOf("anthropic", "binary");
    const forward = await instrumentOf("anthropic", "forward");
    await linkQuestion(binary.id, "bool", { n: 9, pYes: 0.7 });
    await linkQuestion(forward.id, "USD_B", { n: 12, medianB: 400 });

    await runDealerJob(postgres.db, "reference-4", LATER);

    // Nine forecasters: the crowd is recorded, but the reference is unmoved and not rewritten.
    const binaryRows = await referencesOf(binary.listing_id, "binary");
    expect(binaryRows).toHaveLength(1);

    const forwardRef = (await referencesOf(forward.listing_id, "forward")).at(-1)!;
    const components = forwardRef.components_json as unknown as ReferenceComponents;
    expect(components.crowd).toMatchObject({
      n_forecasters: 12,
      unit: "USD_B",
      reported: 400,
      value: Math.log(400e9),
    });
    expect(forwardRef.w_crowd).toBe(BLEND_SCHEDULE.crowd.max_weight);
    expect(forwardRef.w_model).toBeCloseTo(1 - BLEND_SCHEDULE.crowd.max_weight, 15);
    expect(forwardRef.value).toBeCloseTo(0.7 * components.model.value + 0.3 * Math.log(400e9), 12);

    const verification = await verifyDealer(postgres.db);
    expect(verification.findings).toEqual([]);
  });

  it("flags a row whose value does not recompute from its components", async () => {
    const [row] = await postgres.db.selectFrom("reference_prices").selectAll().limit(1).execute();
    await postgres.db
      .insertInto("reference_prices")
      .values({
        listing_id: row!.listing_id,
        kind: row!.kind,
        as_of: LATER,
        value: row!.value + 0.01,
        blend_version: row!.blend_version,
        model_version: row!.model_version,
        rulebook_version: row!.rulebook_version,
        w_model: row!.w_model,
        w_traded: row!.w_traded,
        w_crowd: row!.w_crowd,
        components_json: JSON.stringify(row!.components_json),
      })
      .execute();
    const verification = await verifyDealer(postgres.db);
    expect(verification.passed).toBe(false);
    expect(verification.findings).toEqual([
      expect.objectContaining({ check: "reference_recompute" }),
    ]);
  });
});
