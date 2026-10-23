import { describe, expect, it } from "vitest";
import {
  binarySlippageGuard,
  canonicalDollarAmount,
  slippageCents,
} from "../../src/lib/client/use-trade-execution.js";

describe("order wire amounts", () => {
  it("canonicalizes decimals and rejects exponent notation and fractional cents", () => {
    expect(canonicalDollarAmount("0010.5")).toBe("10.50");
    for (const value of ["1e2", "10.555", "0", "-1", "NaN", ""])
      expect(canonicalDollarAmount(value)).toBeNull();
  });
  it("rounds one-percent bounds outward using integer cents", () => {
    for (const cents of ["1", "99", "100", "101", "99999999999999"]) {
      const amount = BigInt(cents);
      expect(BigInt(slippageCents(cents, "buy")) * 100n).toBeGreaterThanOrEqual(amount * 101n);
      expect(BigInt(slippageCents(cents, "sell")) * 100n).toBeLessThanOrEqual(amount * 99n);
    }
    expect(binarySlippageGuard("buy", "10.50", "1049")).toEqual({ usd: "10.50", cents: 1050 });
    expect(binarySlippageGuard("buy", null, "101")).toEqual({ usd: "1.03", cents: 103 });
  });
});
