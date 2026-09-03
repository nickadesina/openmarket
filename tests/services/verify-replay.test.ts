import { describe, expect, it } from "vitest";

import { probabilities, quantizeBuyCostCents, tradeCost } from "../../src/lib/engine/lmsr.js";
import { EPS } from "../../src/lib/engine/types.js";
import { analyzeReplay, type ReplaySnapshot } from "../../src/lib/services/verify-replay.js";

const MARKET_ID = "market-1";
const TRADE_TIME = new Date("2026-01-01T00:01:00.000Z");
const Q_AFTER = [0, 1] as const;
const METRIC_AFTER = probabilities(Q_AFTER, 10)[1]!;
const CASH_CENTS = quantizeBuyCostCents(tradeCost([0, 0], [0, 1], 10));

function cleanSnapshot(): ReplaySnapshot {
  return {
    markets: [
      {
        id: MARKET_ID,
        companySlug: "example-co",
        nBuckets: 2,
        b: 10,
        initialQ: [0, 0],
        q: Q_AFTER,
        lastMarketSequence: "1",
        mmCashFlowCents: CASH_CENTS.toString(),
        roundingReserveCents: "1",
      },
    ],
    trades: [
      {
        id: "trade-1",
        marketId: MARKET_ID,
        marketSequence: "1",
        action: "buy",
        delta: [0, 1],
        cashAmountCents: CASH_CENTS.toString(),
        redemptionQuantity: 0,
        redemptionCents: "0",
        metricAfter: METRIC_AFTER,
        createdAt: TRADE_TIME,
      },
    ],
    marks: [
      {
        marketId: MARKET_ID,
        marketSequence: "0",
        tradeId: null,
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        value: 0.5,
      },
      {
        marketId: MARKET_ID,
        marketSequence: "1",
        tradeId: "trade-1",
        timestamp: TRADE_TIME,
        value: METRIC_AFTER,
      },
    ],
    holdings: [{ userId: "user-1", marketId: MARKET_ID, h: [0, 1] }],
    users: [{ id: "user-1", cashBalanceCents: (10_000_000 - CASH_CENTS).toString() }],
  };
}

describe("analyzeReplay", () => {
  it("reports a clean replay and reconciles quantized cash separately from reserve", () => {
    const report = analyzeReplay(cleanSnapshot());
    const market = report.markets[0]!;

    expect(report.passed).toBe(true);
    expect(market.passed).toBe(true);
    expect(market.maxBucketDrift).toMatchObject({
      absolute: 0,
      bucketIndex: 0,
      exceedsTolerance: false,
    });
    expect(market.pmfNormalizationError).not.toBeNull();
    expect(market.pmfNormalizationError!).toBeLessThanOrEqual(EPS);
    expect(market.tradeSequences).toMatchObject({
      observed: ["1"],
      missingRanges: [],
      duplicates: [],
      contiguous: true,
    });
    expect(market.markSequences).toMatchObject({
      observed: ["0", "1"],
      missingRanges: [],
      duplicates: [],
      contiguous: true,
    });
    expect(market.negativeHoldings).toEqual([]);
    expect(market.tradeEconomics).toEqual([]);
    expect(market.tradeMarkCardinality).toEqual([]);
    expect(market.tradeMarkDisagreements).toEqual([]);
    expect(market.timestampInversions).toEqual([]);
    expect(report.cashReconciliation).toMatchObject({
      seededBalanceCents: "10000000",
      currentUserCashCents: (10_000_000 - CASH_CENTS).toString(),
      marketMakerCashFlowCents: CASH_CENTS.toString(),
      roundingReserveCents: "1",
      differenceCents: "0",
      roundingReserveAccounting:
        "Rounding reserve is reported separately and excluded from the difference because user cash and MM flow both record the same quantized transfers.",
      passed: true,
    });
  });

  it("flags a balanced trade whose stored cents disagree with the engine", () => {
    const snapshot = cleanSnapshot();
    const trade = snapshot.trades[0]!;
    const skimmed = (CASH_CENTS + 5).toString();
    const report = analyzeReplay({
      ...snapshot,
      markets: [{ ...snapshot.markets[0]!, mmCashFlowCents: skimmed }],
      trades: [{ ...trade, cashAmountCents: skimmed, redemptionCents: "1" }],
      users: [{ id: "user-1", cashBalanceCents: (10_000_000 - CASH_CENTS - 5).toString() }],
    });
    const market = report.markets[0]!;

    expect(report.cashReconciliation.passed).toBe(true);
    expect(market.passed).toBe(false);
    expect(market.tradeEconomics).toEqual([
      {
        tradeId: "trade-1",
        marketSequence: "1",
        field: "cash_amount_cents",
        expected: CASH_CENTS.toString(),
        persisted: skimmed,
      },
      {
        tradeId: "trade-1",
        marketSequence: "1",
        field: "redemption_cents",
        expected: "0",
        persisted: "1",
      },
    ]);
    expect(report.summary.tradeEconomicsFailureCount).toBe(2);
  });

  it("returns structured findings for corrupted state and history", () => {
    const snapshot = cleanSnapshot();
    const corrupted: ReplaySnapshot = {
      ...snapshot,
      markets: [
        {
          ...snapshot.markets[0]!,
          q: [0.25, 1],
          lastMarketSequence: "3",
          mmCashFlowCents: (CASH_CENTS - 5).toString(),
        },
      ],
      trades: [
        snapshot.trades[0]!,
        {
          id: "trade-2",
          marketId: MARKET_ID,
          marketSequence: "1",
          action: "buy",
          delta: [1, 0],
          cashAmountCents: "0",
          redemptionQuantity: 0,
          redemptionCents: "0",
          metricAfter: 0.48,
          createdAt: new Date("2026-01-01T00:02:00.000Z"),
        },
        {
          id: "trade-3",
          marketId: MARKET_ID,
          marketSequence: "3",
          action: "buy",
          delta: [0, 0.5],
          cashAmountCents: "0",
          redemptionQuantity: 0,
          redemptionCents: "0",
          metricAfter: 0.53,
          createdAt: new Date("2026-01-01T00:03:00.000Z"),
        },
      ],
      marks: [
        snapshot.marks[0]!,
        {
          marketId: MARKET_ID,
          marketSequence: "1",
          tradeId: "trade-2",
          timestamp: new Date("2026-01-01T00:01:00.000Z"),
          value: 0.99,
        },
        {
          marketId: MARKET_ID,
          marketSequence: "1",
          tradeId: "unknown-trade",
          timestamp: new Date("2026-01-01T00:02:00.000Z"),
          value: 0.4,
        },
        {
          marketId: MARKET_ID,
          marketSequence: "3",
          tradeId: "trade-1",
          timestamp: new Date("2025-12-31T23:59:00.000Z"),
          value: 0.1,
        },
      ],
      holdings: [
        {
          userId: "user-1",
          marketId: MARKET_ID,
          h: [-(EPS * 2), 1],
        },
      ],
    };

    const report = analyzeReplay(corrupted);
    const market = report.markets[0]!;

    expect(report.passed).toBe(false);
    expect(market.maxBucketDrift.exceedsTolerance).toBe(true);
    expect(market.negativeHoldings).toEqual([
      { userId: "user-1", bucketIndex: 0, value: -(EPS * 2) },
    ]);
    expect(market.tradeSequences.missingRanges).toEqual([{ from: "2", to: "2" }]);
    expect(market.tradeSequences.duplicates).toEqual([{ sequence: "1", count: 2 }]);
    expect(market.markSequences.missingRanges).toEqual([{ from: "2", to: "2" }]);
    expect(market.markSequences.duplicates).toEqual([{ sequence: "1", count: 2 }]);
    expect(market.tradeMarkCardinality.map((finding) => finding.tradeId)).toEqual([
      "trade-1",
      "trade-2",
      "trade-3",
    ]);
    expect(market.tradeMarkDisagreements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          markSequence: "1",
          markTradeId: "trade-2",
          fields: expect.arrayContaining(["timestamp", "metric"]),
        }),
        expect.objectContaining({
          markSequence: "1",
          markTradeId: "unknown-trade",
          fields: ["trade_not_found"],
        }),
        expect.objectContaining({
          markSequence: "3",
          markTradeId: "trade-1",
          expectedTradeId: "trade-3",
          fields: expect.arrayContaining(["trade_id", "timestamp", "metric"]),
        }),
      ]),
    );
    expect(market.timestampInversions).toHaveLength(1);
    expect(market.timestampInversions[0]).toMatchObject({
      earlierSequence: "1",
      laterSequence: "3",
    });
    expect(report.cashReconciliation).toMatchObject({
      differenceCents: "-5",
      passed: false,
    });
    expect(report.summary).toMatchObject({
      failedMarketCount: 1,
      negativeHoldingCount: 1,
      sequenceFailureCount: 2,
      tradeMarkCardinalityFailureCount: 3,
      timestampInversionCount: 1,
    });
  });

  it("compresses large sequence gaps and reports invalid vectors without throwing", () => {
    const snapshot = cleanSnapshot();
    const report = analyzeReplay({
      ...snapshot,
      markets: [
        {
          ...snapshot.markets[0]!,
          nBuckets: 3,
          q: [Number.NaN, 1],
          lastMarketSequence: "1000000000000",
        },
      ],
    });
    const market = report.markets[0]!;

    expect(report.passed).toBe(false);
    expect(market.tradeSequences.missingRanges).toEqual([{ from: "2", to: "1000000000000" }]);
    expect(market.markSequences.missingRanges).toEqual([{ from: "2", to: "1000000000000" }]);
    expect(market.pmfNormalizationError).toBeNull();
    expect(market.stateFindings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["INVALID_VECTOR_LENGTH", "NONFINITE_VECTOR_VALUE", "INVALID_PMF"]),
    );
  });
});
