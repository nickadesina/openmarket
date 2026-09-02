import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  lmsrCost,
  probabilities,
  quantizeBuyCostCents,
  quantizeEntitlementCents,
  quantizeSellProceedsCents,
  solveBuyQuantityForSpend,
  tradeCost,
} from "../../src/lib/engine/lmsr.js";

describe("stable LMSR math", () => {
  it("computes the cost and softmax at the symmetric state", () => {
    expect(lmsrCost([0, 0, 0, 0], 10)).toBeCloseTo(10 * Math.log(4), 12);
    expect(probabilities([0, 0, 0, 0], 10)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("is stable under a large translation of every bucket", () => {
    const q = [-2, 0, 3];
    const translated = q.map((value) => value + 1_000_000_000_000);
    const delta = [0.75, 0, 0.75];

    const baseProbabilities = probabilities(q, 2);
    const translatedProbabilities = probabilities(translated, 2);
    translatedProbabilities.forEach((probability, index) => {
      expect(probability).toBeCloseTo(baseProbabilities[index]!, 12);
    });
    expect(lmsrCost(translated, 2) - 1_000_000_000_000).toBeCloseTo(lmsrCost(q, 2), 3);
    expect(tradeCost(translated, delta, 2)).toBeCloseTo(tradeCost(q, delta, 2), 12);
  });

  it("prices a full-set delta at exactly its quantity", () => {
    expect(tradeCost([-20, 3, 9, 100], [7.25, 7.25, 7.25, 7.25], 4)).toBeCloseTo(7.25, 12);
  });

  it("does not mutate input vectors", () => {
    const q = Object.freeze([1, 2, 3]);
    const delta = Object.freeze([0, 0.5, 0.5]);

    probabilities(q, 5);
    tradeCost(q, delta, 5);

    expect(q).toEqual([1, 2, 3]);
    expect(delta).toEqual([0, 0.5, 0.5]);
  });

  it("always returns a finite normalized PMF", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.double({
            min: -1_000_000,
            max: 1_000_000,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          { minLength: 1, maxLength: 25 },
        ),
        fc.double({
          min: 0.000001,
          max: 1_000_000,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        (q, b) => {
          const pmf = probabilities(q, b);
          expect(pmf).toHaveLength(q.length);
          for (const probability of pmf) {
            expect(Number.isFinite(probability)).toBe(true);
            expect(probability).toBeGreaterThanOrEqual(0);
          }
          expect(pmf.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe("cash quantization", () => {
  it("rounds buys up and sell proceeds down", () => {
    expect(quantizeBuyCostCents(1)).toBe(100);
    expect(quantizeBuyCostCents(1.000001)).toBe(101);
    expect(quantizeSellProceedsCents(-1)).toBe(100);
    expect(quantizeSellProceedsCents(-1.009999)).toBe(100);
  });

  it("applies the cent-space tolerance only to entitlements", () => {
    expect(quantizeEntitlementCents(0.999999999997)).toBe(100);
    expect(quantizeEntitlementCents(1.009)).toBe(100);
    expect(quantizeEntitlementCents(1.01)).toBe(101);
  });
});

describe("spend-to-shares", () => {
  it("returns a six-decimal buy that never exceeds the spend", () => {
    const q = [0, 0, 0];
    const mask = [false, true, true];
    const beforeQ = [...q];
    const beforeMask = [...mask];

    const result = solveBuyQuantityForSpend(q, mask, 25, 100);

    expect(Number.isInteger(result.quantity * 1_000_000)).toBe(true);
    expect(result.quantity).toBeGreaterThanOrEqual(0.000001);
    expect(result.costUsd).toBeLessThanOrEqual(1);
    expect(result.cashAmountCents).toBeGreaterThanOrEqual(1);
    expect(result.cashAmountCents).toBeLessThanOrEqual(100);
    expect(q).toEqual(beforeQ);
    expect(mask).toEqual(beforeMask);
  });

  it("preserves the spend cap across integer-cent orders", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (spendCents) => {
        const result = solveBuyQuantityForSpend(
          [-4, 0, 6, 10],
          [true, true, false, false],
          30,
          spendCents,
        );
        expect(result.quantity).toBeGreaterThanOrEqual(0.000001);
        expect(result.costUsd).toBeLessThanOrEqual(spendCents / 100);
        expect(result.cashAmountCents).toBeGreaterThanOrEqual(1);
        expect(result.cashAmountCents).toBeLessThanOrEqual(spendCents);
      }),
      { numRuns: 100 },
    );
  });
});

describe("domain validation", () => {
  it("rejects invalid LMSR states and vector lengths", () => {
    expect(() => lmsrCost([], 1)).toThrow(RangeError);
    expect(() => lmsrCost([0, Number.NaN], 1)).toThrow(RangeError);
    expect(() => probabilities([0, Infinity], 1)).toThrow(RangeError);
    expect(() => probabilities([0, 1], 0)).toThrow(RangeError);
    expect(() => tradeCost([0, 1], [1], 1)).toThrow(RangeError);
    expect(() => tradeCost([0, 1], [0, -Infinity], 1)).toThrow(RangeError);
  });

  it("rejects invalid spend orders", () => {
    expect(() => solveBuyQuantityForSpend([0, 0], [true], 1, 100)).toThrow(RangeError);
    expect(() => solveBuyQuantityForSpend([0, 0], [false, false], 1, 100)).toThrow(RangeError);
    expect(() => solveBuyQuantityForSpend([0, 0], [true, false], 1, 0)).toThrow(RangeError);
    expect(() => solveBuyQuantityForSpend([0, 0], [true, false], 1, 0.5)).toThrow(RangeError);
  });

  it("rejects non-finite values and quantizer sign mismatches", () => {
    expect(() => quantizeBuyCostCents(-0.01)).toThrow(RangeError);
    expect(() => quantizeBuyCostCents(Infinity)).toThrow(RangeError);
    expect(() => quantizeSellProceedsCents(0.01)).toThrow(RangeError);
    expect(() => quantizeSellProceedsCents(Number.NaN)).toThrow(RangeError);
    expect(() => quantizeEntitlementCents(-0.01)).toThrow(RangeError);
  });
});
