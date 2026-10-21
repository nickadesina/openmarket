import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DEALER_PARAMS } from "../../../src/lib/config/dealer.js";
import {
  BINARY_NO_INDEX,
  BINARY_YES_INDEX,
  binaryLossBoundUsd,
  checkBinaryClamp,
  clampedLossBoundUsd,
  seedBinary,
  seedLossBoundUsd,
  withinClamp,
} from "../../../src/lib/engine/dealer/binary.js";
import { probabilities, tradeCost } from "../../../src/lib/engine/lmsr.js";

const { b_usd: B, p_floor: P_FLOOR } = DEALER_PARAMS.dealer;
const insideClamp = fc.double({ min: P_FLOOR, max: 1 - P_FLOOR, noNaN: true });

function yesDelta(quantity: number): number[] {
  const delta = [0, 0];
  delta[BINARY_YES_INDEX] = quantity;
  return delta;
}

function noDelta(quantity: number): number[] {
  const delta = [0, 0];
  delta[BINARY_NO_INDEX] = quantity;
  return delta;
}

describe("seedBinary", () => {
  it("reproduces the model p at the published b", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 0.999, noNaN: true }), (p) => {
        const seeded = seedBinary(p, B);
        expect(seeded.yesProbability).toBe(p);
        expect(probabilities(seeded.q, B)[BINARY_YES_INDEX]).toBeCloseTo(p, 10);
        expect(
          seeded.probabilities[BINARY_NO_INDEX] + seeded.probabilities[BINARY_YES_INDEX],
        ).toBeCloseTo(1, 12);
      }),
    );
  });

  it("throws RangeError on a degenerate seed", () => {
    expect(() => seedBinary(0, B)).toThrow(RangeError);
    expect(() => seedBinary(1, B)).toThrow(RangeError);
    expect(() => seedBinary(Number.NaN, B)).toThrow(RangeError);
    expect(() => seedBinary(0.5, 0)).toThrow(RangeError);
  });
});

describe("the price clamp", () => {
  // From 50/50, P(YES) = 1 − p_floor exactly when q_yes − q_no = b·ln((1 − p_floor)/p_floor).
  const edge = B * Math.log((1 - P_FLOOR) / P_FLOOR);
  const flat = seedBinary(0.5, B).q;

  it("refuses a YES buy that would lift the price past 1 − p_floor", () => {
    expect(checkBinaryClamp(flat, yesDelta(edge * 0.999), B, P_FLOOR).ok).toBe(true);
    const refused = checkBinaryClamp(flat, yesDelta(edge * 1.001), B, P_FLOOR);
    expect(refused).toMatchObject({ ok: false, reason: "above_ceiling" });
    expect(refused.yesProbabilityAfter).toBeGreaterThan(1 - P_FLOOR);
  });

  it("refuses a NO buy (or YES sale) that would drop the price below p_floor", () => {
    expect(checkBinaryClamp(flat, noDelta(edge * 0.999), B, P_FLOOR).ok).toBe(true);
    expect(checkBinaryClamp(flat, noDelta(edge * 1.001), B, P_FLOOR)).toMatchObject({
      ok: false,
      reason: "below_floor",
    });
    expect(checkBinaryClamp(flat, yesDelta(-edge * 1.001), B, P_FLOOR)).toMatchObject({
      ok: false,
      reason: "below_floor",
    });
  });

  it("includes both edges", () => {
    expect(withinClamp(P_FLOOR, P_FLOOR)).toBe(true);
    expect(withinClamp(1 - P_FLOOR, P_FLOOR)).toBe(true);
    expect(withinClamp(P_FLOOR - 1e-9, P_FLOOR)).toBe(false);
    expect(withinClamp(1 - P_FLOOR + 1e-9, P_FLOOR)).toBe(false);
  });

  it("throws RangeError on the wrong shape or non-finite inputs", () => {
    expect(() => checkBinaryClamp([0, 0, 0], [0, 0, 1], B, P_FLOOR)).toThrow(RangeError);
    expect(() => checkBinaryClamp(flat, [0, Number.NaN], B, P_FLOOR)).toThrow(RangeError);
    expect(() => checkBinaryClamp(flat, [0, 1], B, 0.5)).toThrow(RangeError);
  });
});

describe("worst-case house loss", () => {
  it("is b·ln(1/p_floor) ≈ $5,991.46 per quarter at the published b and p_floor", () => {
    expect(B).toBe(2000);
    expect(P_FLOOR).toBe(0.05);
    expect(binaryLossBoundUsd(B, P_FLOOR)).toBeCloseTo(5991.46, 2);
  });

  it("is b·ln 2 unclamped only from 50/50, and larger from any other seed", () => {
    expect(seedLossBoundUsd(B, 0.5)).toBeCloseTo(B * Math.LN2, 9);
    expect(seedLossBoundUsd(B, 0.2)).toBeCloseTo(B * Math.log(5), 9);
    expect(seedLossBoundUsd(B, 0.8)).toBeCloseTo(B * Math.log(5), 9);
  });

  it("never exceeds the published bound for a seed inside the clamp", () => {
    fc.assert(
      fc.property(insideClamp, (p0) => {
        expect(clampedLossBoundUsd(B, p0, P_FLOOR)).toBeLessThanOrEqual(
          binaryLossBoundUsd(B, P_FLOOR) + 1e-9,
        );
      }),
    );
  });

  it("holds against any sequence of clamp-accepted trades, whichever outcome wins", () => {
    const trade = fc.tuple(
      fc.constantFrom(BINARY_NO_INDEX, BINARY_YES_INDEX),
      fc.double({ min: -3 * B, max: 3 * B, noNaN: true }),
    );
    fc.assert(
      fc.property(insideClamp, fc.array(trade, { maxLength: 30 }), (p0, trades) => {
        const seed = seedBinary(p0, B).q;
        let q = [...seed];
        let collected = 0;
        for (const [index, quantity] of trades) {
          const delta = index === BINARY_YES_INDEX ? yesDelta(quantity) : noDelta(quantity);
          if (!checkBinaryClamp(q, delta, B, P_FLOOR).ok) continue;
          collected += tradeCost(q, delta, B);
          q = q.map((value, i) => value + delta[i]!);
        }
        const bound = clampedLossBoundUsd(B, p0, P_FLOOR);
        for (const winner of [BINARY_NO_INDEX, BINARY_YES_INDEX]) {
          const loss = q[winner]! - seed[winner]! - collected;
          expect(loss).toBeLessThanOrEqual(bound + 1e-6);
        }
      }),
    );
  });
});
