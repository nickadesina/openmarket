import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DEALER_PARAMS, MODEL_VERSION } from "../../src/lib/config/dealer.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/dealer/rulebook.js";
import { executeForwardTrade } from "../../src/lib/services/dealer/execute-forward-trade.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { executeTrade } from "../../src/lib/services/execute-trade.js";
import { getActivity } from "../../src/lib/services/get-activity.js";
import { getMarket } from "../../src/lib/services/get-market.js";
import { getMarks } from "../../src/lib/services/get-marks.js";
import { listMarkets } from "../../src/lib/services/list-markets.js";
import { getPortfolio } from "../../src/lib/services/portfolio.js";
import { NAMES, seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  createTrader,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * The read model a market page, the board and the portfolio are drawn from:
 * every listed name with its live binary and forward, the implied
 * distribution, open interest, marks by market id and forward positions.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Listing read PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Listing read PostgreSQL integration";

const LISTED_AT = new Date("2026-10-20T00:00:00.000Z");
const RUN_AT = new Date("2026-10-20T00:05:00.000Z");
const TRADE_AT = new Date("2026-10-20T01:00:00.000Z");
const READ_AT = new Date("2026-10-20T02:00:00.000Z");

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    await seedFixtureListings(postgres.db, LISTED_AT);
    await runDealerJob(postgres.db, "listing-read-1", RUN_AT);
  });

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  it("lists every listed name with both live contracts and the versions behind them", async () => {
    const list = await listMarkets(postgres.db, { now: READ_AT });
    expect(list.listings.map((listing) => listing.company.name).sort()).toEqual(
      [...NAMES].sort(),
    );
    expect(list.modelVersion).toBe(MODEL_VERSION);
    expect(list.rulebookVersion).toBe(RULEBOOK_VERSION);
    for (const listing of list.listings) {
      expect(listing.forward?.kind).toBe("forward");
      expect(listing.binary?.kind).toBe("binary");
      expect(listing.forward!.bid_usd).toBeLessThan(listing.forward!.ask_usd);
      expect(listing.forward!.model_version).toBe(MODEL_VERSION);
      expect(listing.binary!.rulebook_version).toBe(RULEBOOK_VERSION);
      expect(listing.openInterest).toEqual({ forwardNotionalUsd: 0, binaryUsd: 0, totalUsd: 0 });
      expect(listing.vsLastRound).toBeCloseTo(
        listing.forward!.mid_usd / Number(listing.anchor.postMoneyUsd) - 1,
        12,
      );
    }
  });

  it("derives the read-only ladder from the forward mid and the tier's sigma", async () => {
    const detail = await getMarket(postgres.db, "anthropic", { now: READ_AT });
    const distribution = detail.distribution!;
    expect(distribution.centerUsd).toBe(detail.forward!.mid_usd);
    expect(distribution.sigma).toBe(DEALER_PARAMS.sigma_tier[detail.tier]);
    expect(distribution.pmf).toHaveLength(41);
    expect(distribution.strikes).toHaveLength(40);
    expect(distribution.pmf.reduce((sum, mass) => sum + mass, 0)).toBeCloseTo(1, 12);
    expect(distribution.band.p10).toBeLessThan(distribution.band.p50);
    expect(distribution.band.p50).toBeLessThan(distribution.band.p90);
    const above = distribution.strikes.map((strike) => strike.probabilityAbove);
    expect([...above].sort((left, right) => right - left)).toEqual(above);
    expect(detail.epochs.map((epoch) => epoch.kind).sort()).toEqual(["binary", "forward"]);
    expect(detail.epochs.every((epoch) => epoch.marketStatus === "open")).toBe(true);
  });

  it("refuses an unlisted slug", async () => {
    await expect(getMarket(postgres.db, "stripe", { now: READ_AT })).rejects.toMatchObject({
      code: "MARKET_NOT_FOUND",
    });
  });

  it("reads fills back through open interest, marks, activity and the portfolio", async () => {
    const trader = await createTrader(postgres.db, "listing_reader");
    const before = await getMarket(postgres.db, "modal", { now: TRADE_AT });
    const forward = before.forward!;
    const binary = before.binary!;
    const filled = await executeForwardTrade(
      postgres.db,
      trader.id,
      {
        idempotency_key: randomUUID(),
        instrument_id: forward.instrument_id,
        side: "long",
        notional_usd: "1000.00",
        max_entry_ln: forward.ask_ln,
      },
      { now: TRADE_AT },
    );
    await executeTrade(
      postgres.db,
      trader.id,
      {
        idempotency_key: randomUUID(),
        market_id: binary.market_id,
        action: "buy",
        side: "yes",
        strike_index: 0,
        spend_usd: "25.00",
        max_cost_usd: "25.00",
      },
      { now: TRADE_AT },
    );

    const after = await getMarket(postgres.db, "modal", { now: READ_AT });
    expect(after.openInterest.forwardNotionalUsd).toBe(1000);
    expect(after.openInterest.binaryUsd).toBeGreaterThan(0);
    expect(after.forward!.inventory_cents).toBe("-100000");
    expect(after.lastTradeAt).not.toBeNull();

    const marks = await getMarks(postgres.db, forward.market_id, "all", { now: READ_AT });
    expect(marks.metricKind).toBe("forward_ln");
    expect(marks.points.length).toBeGreaterThanOrEqual(2);
    expect(marks.currentMetric).toBeCloseTo(after.forward!.mid_usd, 6);

    const activity = await getActivity(postgres.db, { slug: "modal" });
    const forwardItem = activity.items.find((item) => item.metricKind === "forward_ln")!;
    expect(forwardItem).toMatchObject({
      side: "long",
      quantity: 1000,
      cashAmountCents: filled.result.collateral_cents,
      marketId: forward.market_id,
    });
    expect(forwardItem.entryUsd).toBeCloseTo(filled.result.entry_usd, 9);

    const portfolio = await getPortfolio(postgres.db, trader.id, { now: READ_AT });
    expect(portfolio.forwardPositions).toHaveLength(1);
    const position = portfolio.forwardPositions[0]!;
    expect(position).toMatchObject({
      side: "long",
      notionalCents: "100000",
      collateralCents: filled.result.collateral_cents,
      maxGainCents: filled.result.max_gain_cents,
      maxLossCents: filled.result.max_loss_cents,
      expiresAt: filled.result.expires_at,
    });
    expect(position.entryUsd).toBeCloseTo(filled.result.entry_usd, 9);
    // A long filled at the ask is under water at the mid by the half-spread.
    expect(Number(position.unrealisedCents)).toBeLessThan(0);
    expect(portfolio.forwardCollateralCents).toBe(filled.result.collateral_cents);
    expect(portfolio.accountValueUsd).toBeCloseTo(
      Number(portfolio.cashBalanceCents) / 100 +
        portfolio.holdingsMarkedValueUsd +
        Number(position.markedValueCents) / 100,
      6,
    );
    expect(portfolio.markets).toHaveLength(1);
    expect(portfolio.markets[0]!.positions[0]).toMatchObject({ side: "yes" });
  });
});
