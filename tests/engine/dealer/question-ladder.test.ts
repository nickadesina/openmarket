import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { VALUATION_BOUNDARIES_USD } from "../../../src/lib/engine/buckets.js";
import {
  forwardQuestionLadder,
  inLadderUnit,
  QUESTION_LADDER_VERSION,
} from "../../../src/lib/engine/dealer/question-ladder.js";
import { assertValidBuckets, numericBuckets } from "../../../src/lib/engine/tournament/buckets.js";

const SIGMA_MEGA = 0.3455;
const SIGMA_REDHOT = 0.6204;

describe("forwardQuestionLadder", () => {
  it("takes the grid boundaries between the 1st and 99th percentile, to three figures", () => {
    const ladder = forwardQuestionLadder(Math.log(20e9), SIGMA_MEGA);
    expect(ladder.version).toBe(QUESTION_LADDER_VERSION);
    expect(ladder.unit).toBe("USD_B");
    // P1 ≈ $8.96B, P99 ≈ $44.6B; the half-octave grid ($1T · 2^(k/2)) inside them.
    expect(ladder.lowerUsd).toBeCloseTo(20e9 * Math.exp(-2.3263478740408408 * SIGMA_MEGA), -3);
    expect(ladder.edges).toEqual([11, 15.6, 22.1, 31.3, 44.2]);
  });

  it("switches to USD_T from a $1T mid", () => {
    const ladder = forwardQuestionLadder(Math.log(1.2e12), SIGMA_MEGA);
    expect(ladder.unit).toBe("USD_T");
    expect(ladder.edges.map((edge) => Math.round(edge * 1000))).toEqual([707, 1000, 1410, 2000]);
    expect(inLadderUnit(1.5e12, ladder.unit)).toBe(1.5);
  });

  it("is wider for the red-hot tier", () => {
    const mega = forwardQuestionLadder(Math.log(5e9), SIGMA_MEGA);
    const redhot = forwardQuestionLadder(Math.log(5e9), SIGMA_REDHOT);
    expect(redhot.edges.length).toBeGreaterThan(mega.edges.length);
  });

  it("falls back to the two boundaries bracketing the mid when none is inside", () => {
    const ladder = forwardQuestionLadder(Math.log(20e9), 0.01);
    expect(ladder.edges).toEqual([15.6, 22.1]);
  });

  it("always yields valid, increasing tournament buckets", () => {
    fc.assert(
      fc.property(
        fc.double({ min: Math.log(2e8), max: Math.log(5e12), noNaN: true }),
        fc.constantFrom(SIGMA_MEGA, SIGMA_REDHOT),
        (midLn, sigma) => {
          const ladder = forwardQuestionLadder(midLn, sigma, VALUATION_BOUNDARIES_USD);
          const buckets = numericBuckets({ edges: ladder.edges, floorLabel: "No print" });
          assertValidBuckets(buckets, false);
          expect(buckets.length).toBeGreaterThanOrEqual(3);
        },
      ),
    );
  });

  it("refuses a non-finite mid or a non-positive sigma", () => {
    expect(() => forwardQuestionLadder(Number.NaN, SIGMA_MEGA)).toThrow(RangeError);
    expect(() => forwardQuestionLadder(Math.log(1e9), 0)).toThrow(RangeError);
  });
});
