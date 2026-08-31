import { describe, expect, it } from "vitest";

import { impliedValuationMedian } from "../../src/lib/engine/median.js";

describe("impliedValuationMedian", () => {
  it("interpolates logarithmically inside the median bucket", () => {
    const probabilities = [0.25, 0.5, 0.25];
    const boundaries = [100, 200];

    const median = impliedValuationMedian(probabilities, boundaries);

    expect(median).toBeCloseTo(Math.sqrt(100 * 200), 12);
    expect(median).toBeGreaterThanOrEqual(100);
    expect(median).toBeLessThanOrEqual(200);
  });

  it("uses a square-root-of-two virtual lower edge", () => {
    const boundary = 100;
    const median = impliedValuationMedian([0.75, 0.25], [boundary]);
    const lowerEdge = boundary / Math.sqrt(2);

    expect(median).toBeGreaterThanOrEqual(lowerEdge);
    expect(median).toBeLessThanOrEqual(boundary);
    expect(median).toBeCloseTo(
      Math.exp(
        Math.log(lowerEdge) +
          (0.5 / 0.75) * (Math.log(boundary) - Math.log(lowerEdge)),
      ),
      12,
    );
  });

  it("uses a square-root-of-two virtual upper edge", () => {
    const upperBoundary = 200;
    const median = impliedValuationMedian([0.1, 0.2, 0.7], [100, upperBoundary]);
    const upperEdge = upperBoundary * Math.sqrt(2);

    expect(median).toBeGreaterThanOrEqual(upperBoundary);
    expect(median).toBeLessThanOrEqual(upperEdge);
  });

  it("does not mutate caller-owned vectors", () => {
    const probabilities = [0.4, 0.6];
    const boundaries = [100];
    const originalProbabilities = [...probabilities];
    const originalBoundaries = [...boundaries];

    impliedValuationMedian(probabilities, boundaries);

    expect(probabilities).toEqual(originalProbabilities);
    expect(boundaries).toEqual(originalBoundaries);
  });

  it("rejects invalid lengths, PMFs, and boundaries", () => {
    expect(() => impliedValuationMedian([], [])).toThrow(RangeError);
    expect(() => impliedValuationMedian([0.5, 0.5], [])).toThrow(RangeError);
    expect(() => impliedValuationMedian([0.4, 0.4], [100])).toThrow(RangeError);
    expect(() => impliedValuationMedian([0.5, Number.NaN], [100])).toThrow(RangeError);
    expect(() => impliedValuationMedian([-0.1, 1.1], [100])).toThrow(RangeError);
    expect(() => impliedValuationMedian([0.2, 0.3, 0.5], [100, 100])).toThrow(
      RangeError,
    );
    expect(() => impliedValuationMedian([0.5, 0.5], [Number.POSITIVE_INFINITY])).toThrow(
      RangeError,
    );
  });
});
