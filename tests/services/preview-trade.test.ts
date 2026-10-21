import { describe, expect, it } from "vitest";

import { VALUATION_BOUNDARIES_USD, VALUATION_BUCKET_COUNT } from "../../src/lib/engine/buckets.js";
import { contractDelta, contractMask } from "../../src/lib/engine/contracts.js";
import {
  probabilities,
  quantizeBuyCostCents,
  solveBuyQuantityForSpend,
  tradeCost,
} from "../../src/lib/engine/lmsr.js";
import { impliedValuationMedian } from "../../src/lib/engine/median.js";
import { EPS, MAX_QUANTITY, MAX_TRADE_SPEND_CENTS } from "../../src/lib/engine/types.js";
import { parseRequestedAmount, previewTrade } from "../../src/lib/services/preview-trade.js";

const BINARY_MARKET = {
  metric_kind: "yes_probability" as const,
  bucket_grid_version: "valuation-v1",
  n_buckets: 2,
  b: 100,
  q: [0, 0],
};

describe("previewTrade", () => {
  it("prices a binary buy exactly as the engine does", () => {
    const amount = parseRequestedAmount({ action: "buy", quantity: 10 });
    const preview = previewTrade(
      BINARY_MARKET,
      [0, 0],
      { action: "buy", side: "yes", strike_index: 0 },
      amount,
    );

    const delta = contractDelta(2, 0, "yes", "buy", 10);
    const engineCost = tradeCost([0, 0], delta, 100);
    expect(preview.quantity).toBe(10);
    expect(preview.engineCostUsd).toBeCloseTo(engineCost);
    expect(preview.cashAmountCents).toBe(quantizeBuyCostCents(engineCost));
    expect(preview.strikeValue).toBeNull();
    expect(preview.mask).toEqual(contractMask(2, 0, "yes"));
    expect(preview.priceBefore).toBeCloseTo(0.5);
    expect(preview.priceAfter).toBeGreaterThan(0.5);
  });

  it("rejects an absurd quantity as INVALID_INPUT instead of overflowing", () => {
    expect(() => parseRequestedAmount({ action: "buy", quantity: 1e308 })).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(() => parseRequestedAmount({ action: "sell", quantity: MAX_QUANTITY + 1 })).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  it("caps spend orders at the shared spend ceiling", () => {
    const overCeilingUsd = `${MAX_TRADE_SPEND_CENTS / 100 + 1}.00`;
    expect(() => parseRequestedAmount({ action: "buy", spend_usd: overCeilingUsd })).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(parseRequestedAmount({ action: "buy", spend_usd: "25.50" }).spendCents).toBe(2_550);
  });

  it("rejects sells beyond the sellable holdings with quote-shaped details", () => {
    const amount = parseRequestedAmount({ action: "sell", quantity: 1 });
    expect(() =>
      previewTrade(
        BINARY_MARKET,
        [0, 0.5],
        { action: "sell", side: "yes", strike_index: 0 },
        amount,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "INSUFFICIENT_HOLDINGS",
        details: { requested_quantity: 1, sellable_quantity: 0.5 },
      }),
    );
  });

  it("prices spend orders through the same solver as execution", () => {
    const amount = parseRequestedAmount({ action: "buy", spend_usd: "25.00" });
    const preview = previewTrade(
      BINARY_MARKET,
      [0, 0],
      { action: "buy", side: "yes", strike_index: 0 },
      amount,
    );
    const solved = solveBuyQuantityForSpend([0, 0], contractMask(2, 0, "yes"), 100, 2_500);
    expect(preview.quantity).toBe(solved.quantity);
    expect(preview.cashAmountCents).toBe(solved.cashAmountCents);
    expect(preview.cashAmountCents).toBeLessThanOrEqual(2_500);
  });

  it("enforces the spend ceiling inside previewTrade itself", () => {
    expect(() =>
      previewTrade(
        BINARY_MARKET,
        [0, 0],
        { action: "buy", side: "yes", strike_index: 0 },
        { quantity: undefined, spendCents: MAX_TRADE_SPEND_CENTS + 1 },
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  it("prices a valuation strike with its canonical value and median", () => {
    const market = {
      metric_kind: "valuation_median" as const,
      bucket_grid_version: "valuation-v1",
      n_buckets: VALUATION_BUCKET_COUNT,
      b: 15_000,
      q: new Array<number>(VALUATION_BUCKET_COUNT).fill(0),
    };
    const strikeIndex = 31;
    const preview = previewTrade(
      market,
      new Array<number>(VALUATION_BUCKET_COUNT).fill(0),
      { action: "buy", side: "yes", strike_index: strikeIndex },
      parseRequestedAmount({ action: "buy", quantity: 5 }),
    );
    expect(preview.strikeValue).toBe(VALUATION_BOUNDARIES_USD[strikeIndex]!.toFixed(2));
    expect(preview.metricAfter).toBeCloseTo(
      impliedValuationMedian(probabilities(preview.qAfter, 15_000), VALUATION_BOUNDARIES_USD),
    );
  });

  it("rejects a sell beyond the EPS tolerance but allows half an EPS", () => {
    const request = { action: "sell", side: "yes", strike_index: 0 } as const;
    expect(() =>
      previewTrade(
        BINARY_MARKET,
        [0, 0.5],
        request,
        parseRequestedAmount({ action: "sell", quantity: 0.5 + 2 * EPS }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INSUFFICIENT_HOLDINGS" }));
    const preview = previewTrade(
      BINARY_MARKET,
      [0, 0.5],
      request,
      parseRequestedAmount({ action: "sell", quantity: 0.5 + EPS / 2 }),
    );
    expect(preview.holdingsAfter[1]).toBe(0);
  });

  it("rejects a strike that is invalid for the market kind", () => {
    const amount = parseRequestedAmount({ action: "buy", quantity: 1 });
    expect(() =>
      previewTrade(BINARY_MARKET, [0, 0], { action: "buy", side: "yes", strike_index: 1 }, amount),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  it("refuses a dealer binary's trade that would leave [p_floor, 1 − p_floor], either way", () => {
    const clamp = { pFloor: 0.05 };
    const yes = { action: "buy", side: "yes", strike_index: 0 } as const;
    // ln(0.95/0.05) ≈ 2.944 at b = 100: 290 YES stays inside, 300 does not.
    const inside = previewTrade(
      BINARY_MARKET,
      [0, 0],
      yes,
      parseRequestedAmount({ action: "buy", quantity: 290 }),
      clamp,
    );
    expect(inside.priceAfter).toBeLessThan(0.95);
    expect(() =>
      previewTrade(
        BINARY_MARKET,
        [0, 0],
        yes,
        parseRequestedAmount({ action: "buy", quantity: 300 }),
        clamp,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "PRICE_CLAMPED",
        details: expect.objectContaining({ p_floor: 0.05, p_ceiling: 0.95 }),
      }),
    );
    expect(() =>
      previewTrade(
        BINARY_MARKET,
        [0, 0],
        { ...yes, side: "no" },
        parseRequestedAmount({ action: "buy", quantity: 300 }),
        clamp,
      ),
    ).toThrowError(expect.objectContaining({ code: "PRICE_CLAMPED" }));
    // Without a clamp (a ladder or legacy binary), the same trade prices.
    expect(
      previewTrade(
        BINARY_MARKET,
        [0, 0],
        yes,
        parseRequestedAmount({ action: "buy", quantity: 300 }),
      ).priceAfter,
    ).toBeGreaterThan(0.95);
  });
});
