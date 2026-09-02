import { describe, expect, it } from "vitest";

import {
  VALUATION_BOUNDARIES_USD,
  VALUATION_BUCKET_COUNT,
  VALUATION_GRID_VERSION,
  valuationBucketEdges,
  valuationBucketIndex,
} from "../../src/lib/engine/buckets.js";

describe("valuation grid v1", () => {
  it("exports the canonical 40 formula-derived boundaries", () => {
    const expected = Array.from(
      { length: 40 },
      (_, index) => 1_000_000_000_000 * 2 ** ((index - 32) / 2),
    );

    expect(VALUATION_GRID_VERSION).toBe("valuation-v1");
    expect(VALUATION_BOUNDARIES_USD).toEqual(expected);
    expect(VALUATION_BOUNDARIES_USD).toHaveLength(40);
    expect(VALUATION_BUCKET_COUNT).toBe(41);
    expect(Object.isFrozen(VALUATION_BOUNDARIES_USD)).toBe(true);
  });

  it("uses each boundary as the inclusive upper edge of its bucket", () => {
    expect(valuationBucketIndex(0)).toBe(0);

    for (let index = 0; index < VALUATION_BOUNDARIES_USD.length; index += 1) {
      expect(valuationBucketIndex(VALUATION_BOUNDARIES_USD[index]!)).toBe(index);
    }

    for (let index = 0; index < VALUATION_BOUNDARIES_USD.length - 1; index += 1) {
      const lower = VALUATION_BOUNDARIES_USD[index]!;
      const upper = VALUATION_BOUNDARIES_USD[index + 1]!;
      expect(valuationBucketIndex(Math.sqrt(lower * upper))).toBe(index + 1);
    }

    expect(
      valuationBucketIndex(
        VALUATION_BOUNDARIES_USD[VALUATION_BOUNDARIES_USD.length - 1]! * Math.SQRT2,
      ),
    ).toBe(40);
  });

  it("returns contiguous edges and extends both open ends by one grid step", () => {
    const firstBoundary = VALUATION_BOUNDARIES_USD[0]!;
    const lastBoundary = VALUATION_BOUNDARIES_USD[39]!;
    expect(valuationBucketEdges(0)).toEqual({
      lower: 1_000_000_000_000 * 2 ** (-33 / 2),
      upper: firstBoundary,
    });
    expect(valuationBucketEdges(40)).toEqual({
      lower: lastBoundary,
      upper: 1_000_000_000_000 * 2 ** (8 / 2),
    });

    for (let index = 0; index < VALUATION_BUCKET_COUNT - 1; index += 1) {
      expect(valuationBucketEdges(index).upper).toBe(valuationBucketEdges(index + 1).lower);
    }
  });

  it("rejects invalid bucket indices and valuations", () => {
    for (const index of [-1, 41, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => valuationBucketEdges(index)).toThrow(RangeError);
    }

    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => valuationBucketIndex(value)).toThrow(RangeError);
    }
  });
});
