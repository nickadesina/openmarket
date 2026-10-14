import { describe, expect, it } from "vitest";

import { contractDelta, contractMask } from "../../src/lib/engine/contracts.js";
import { quantizeBuyCostCents, tradeCost } from "../../src/lib/engine/lmsr.js";
import { MAX_QUANTITY, MAX_TRADE_SPEND_CENTS } from "../../src/lib/engine/types.js";
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

  it("rejects a strike that is invalid for the market kind", () => {
    const amount = parseRequestedAmount({ action: "buy", quantity: 1 });
    expect(() =>
      previewTrade(BINARY_MARKET, [0, 0], { action: "buy", side: "yes", strike_index: 1 }, amount),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});
