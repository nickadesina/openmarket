import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { VALUATION_BOUNDARIES_USD } from "../../src/lib/engine/buckets.js";
import {
  lognormalBucketProbabilities,
  MIN_BUCKET_PROBABILITY,
  probabilitiesAbove,
} from "../../src/lib/engine/distribution.js";
import { impliedValuationQuantile } from "../../src/lib/engine/median.js";

const CENTER = 380e9;

describe("lognormalBucketProbabilities", () => {
  it("lays 41 floored, normalized masses over the grid", () => {
    const pmf = lognormalBucketProbabilities(CENTER, 0.3455, VALUATION_BOUNDARIES_USD);
    expect(pmf).toHaveLength(41);
    expect(pmf.reduce((sum, mass) => sum + mass, 0)).toBeCloseTo(1, 12);
    // The floored total is at most 1 + 41 floors, so no bucket falls below this.
    const floor = MIN_BUCKET_PROBABILITY / (1 + 41 * MIN_BUCKET_PROBABILITY);
    for (const mass of pmf) expect(mass).toBeGreaterThanOrEqual(floor);
  });

  it("puts the grid median at the centre and widens with sigma", () => {
    const narrow = lognormalBucketProbabilities(CENTER, 0.3455, VALUATION_BOUNDARIES_USD);
    const wide = lognormalBucketProbabilities(CENTER, 0.6204, VALUATION_BOUNDARIES_USD);
    expect(impliedValuationQuantile(narrow, VALUATION_BOUNDARIES_USD, 0.5) / CENTER).toBeCloseTo(
      1,
      1,
    );
    expect(Math.max(...narrow)).toBeGreaterThan(Math.max(...wide));
  });

  it.each<[number, number, readonly number[]]>([
    [0, 0.3, VALUATION_BOUNDARIES_USD],
    [Number.NaN, 0.3, VALUATION_BOUNDARIES_USD],
    [CENTER, 0, VALUATION_BOUNDARIES_USD],
    [CENTER, Number.POSITIVE_INFINITY, VALUATION_BOUNDARIES_USD],
    [CENTER, 0.3, []],
    [CENTER, 0.3, [2, 1]],
  ])("rejects invalid inputs", (center, sigma, boundaries) => {
    expect(() => lognormalBucketProbabilities(center, sigma, boundaries)).toThrow(RangeError);
  });
});

describe("probabilitiesAbove", () => {
  it("is the tail mass above each boundary", () => {
    expect(probabilitiesAbove([0.2, 0.3, 0.5])).toEqual([0.8, 0.5]);
  });

  it("falls monotonically from near one to near zero over the grid", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e8, max: 5e12, noNaN: true }),
        fc.double({ min: 0.1, max: 1.5, noNaN: true }),
        (center, sigma) => {
          const above = probabilitiesAbove(
            lognormalBucketProbabilities(center, sigma, VALUATION_BOUNDARIES_USD),
          );
          expect(above).toHaveLength(40);
          for (let index = 1; index < above.length; index += 1) {
            expect(above[index]!).toBeLessThan(above[index - 1]!);
          }
          expect(above[0]!).toBeLessThanOrEqual(1);
          expect(above.at(-1)!).toBeGreaterThan(0);
        },
      ),
      { numRuns: 48, seed: 0xd157 },
    );
  });

  it("rejects a vector with fewer than two buckets or a negative mass", () => {
    expect(() => probabilitiesAbove([1])).toThrow(RangeError);
    expect(() => probabilitiesAbove([0.5, -0.1, 0.6])).toThrow(RangeError);
  });
});
