import { describe, expect, it } from "vitest";

import { impliedValuationQuantile } from "../../src/lib/engine/median.js";

const impliedValuationMedian = (probabilities: readonly number[], boundaries: readonly number[]) =>
  impliedValuationQuantile(probabilities, boundaries, 0.5);

describe("impliedValuationQuantile at the median", () => {
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
      Math.exp(Math.log(lowerEdge) + (0.5 / 0.75) * (Math.log(boundary) - Math.log(lowerEdge))),
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
    expect(() => impliedValuationMedian([0.2, 0.3, 0.5], [100, 100])).toThrow(RangeError);
    expect(() => impliedValuationMedian([0.5, 0.5], [Number.POSITIVE_INFINITY])).toThrow(
      RangeError,
    );
  });
});

describe("impliedValuationQuantile", () => {
  const probabilities = [0.25, 0.5, 0.25];
  const boundaries = [100, 200];

  it("agrees with the median at the 50th percentile", () => {
    expect(impliedValuationQuantile(probabilities, boundaries, 0.5)).toBe(
      impliedValuationMedian(probabilities, boundaries),
    );
  });

  it("lands exactly on a boundary when the cumulative mass reaches it there", () => {
    expect(impliedValuationQuantile(probabilities, boundaries, 0.25)).toBeCloseTo(100, 12);
    expect(impliedValuationQuantile(probabilities, boundaries, 0.75)).toBeCloseTo(200, 12);
  });

  it("interpolates logarithmically into the open upper bucket", () => {
    const upperEdge = 200 * Math.sqrt(2);
    const expected = Math.exp(
      Math.log(200) + ((0.9 - 0.75) / 0.25) * (Math.log(upperEdge) - Math.log(200)),
    );
    expect(impliedValuationQuantile(probabilities, boundaries, 0.9)).toBeCloseTo(expected, 12);
  });

  it("is monotonic in the quantile", () => {
    const values = [0.05, 0.1, 0.5, 0.9, 0.95].map((quantile) =>
      impliedValuationQuantile(probabilities, boundaries, quantile),
    );
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  it("rejects quantiles outside the open unit interval", () => {
    expect(() => impliedValuationQuantile(probabilities, boundaries, 0)).toThrow(RangeError);
    expect(() => impliedValuationQuantile(probabilities, boundaries, 1)).toThrow(RangeError);
  });
});
