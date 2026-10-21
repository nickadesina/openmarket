import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  BLEND_SCHEDULE,
  BLEND_VERSION,
  blend,
  blendWeights,
  crowdForwardLn,
  crowdWeight,
  tradedWeight,
} from "../../../src/lib/engine/dealer/blend.js";

const { traded: T, crowd: C } = BLEND_SCHEDULE;

const volume = fc.double({ min: 0, max: 1e9, noNaN: true });
const forecasters = fc.integer({ min: 0, max: 100_000 });
const lnLevel = fc.double({ min: 15, max: 30, noNaN: true });
const probability = fc.double({ min: 0, max: 1, noNaN: true });
const openProbability = fc.double({ min: 1e-6, max: 1 - 1e-6, noNaN: true });

describe("blend schedule", () => {
  it("publishes the TECHNICAL_DESIGN §8 constants under a semver", () => {
    expect(BLEND_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BLEND_SCHEDULE).toEqual({
      version: BLEND_VERSION,
      traded: { max_weight: 0.6, v0_usd: 50_000, window_days: 30 },
      crowd: { max_weight: 0.3, n0: 20, n_min: 10 },
    });
    expect(Object.isFrozen(BLEND_SCHEDULE)).toBe(true);
  });

  it("weights flow by V/(V+V₀) under its cap", () => {
    expect(tradedWeight(0)).toBe(0);
    expect(tradedWeight(50_000)).toBeCloseTo(0.5, 15);
    expect(tradedWeight(10_000)).toBeCloseTo(10_000 / 60_000, 15);
    expect(tradedWeight(1e9)).toBe(0.6);
  });

  it("gives the crowd nothing below N_min and its cap at and above it", () => {
    expect(crowdWeight(0)).toBe(0);
    expect(crowdWeight(9)).toBe(0);
    // n/(n+20) ≥ 1/3 > 0.3 once n ≥ 10, so the cap always binds: w_c is 0 or 0.3.
    expect(crowdWeight(10)).toBe(0.3);
    expect(crowdWeight(500)).toBe(0.3);
    expect(() => crowdWeight(2.5)).toThrow(RangeError);
    expect(() => crowdWeight(-1)).toThrow(RangeError);
  });

  it("blends a hand-computed forward (illustrative inputs)", () => {
    // V = $50k → w_t = 0.5; n = 12 → w_c = 0.3; w_m = 0.2.
    const result = blend({
      kind: "forward",
      model: 24,
      traded: { value: 24.5, volumeUsd: 50_000 },
      crowd: { value: 25, forecasters: 12 },
    });
    expect(result.weights.traded).toBeCloseTo(0.5, 15);
    expect(result.weights.crowd).toBe(0.3);
    expect(result.weights.model).toBeCloseTo(0.2, 15);
    expect(result.value).toBeCloseTo(0.2 * 24 + 0.5 * 24.5 + 0.3 * 25, 12);
    expect(result.modelOnly).toBe(false);
  });

  it("takes the crowd's median post-money into ln USD", () => {
    expect(crowdForwardLn(61e9)).toBe(Math.log(61e9));
    expect(() => crowdForwardLn(0)).toThrow(RangeError);
  });

  it("refuses inputs outside their unit", () => {
    expect(() => blend({ kind: "binary", model: 1, traded: null, crowd: null })).toThrow(
      RangeError,
    );
    expect(() =>
      blend({ kind: "binary", model: 0.4, traded: { value: 1.2, volumeUsd: 10 }, crowd: null }),
    ).toThrow(RangeError);
    expect(() => blend({ kind: "forward", model: Number.NaN, traded: null, crowd: null })).toThrow(
      RangeError,
    );
    expect(() =>
      blend({ kind: "forward", model: 24, traded: { value: 24, volumeUsd: -1 }, crowd: null }),
    ).toThrow(RangeError);
  });
});

describe("blend properties", () => {
  it("weights sum to one and stay inside their bounds", () => {
    fc.assert(
      fc.property(volume, forecasters, (v, n) => {
        const w = blendWeights(v, n);
        expect(Math.abs(w.model + w.traded + w.crowd - 1)).toBeLessThan(1e-12);
        expect(w.traded).toBeGreaterThanOrEqual(0);
        expect(w.traded).toBeLessThanOrEqual(T.max_weight);
        expect(w.crowd).toBeGreaterThanOrEqual(0);
        expect(w.crowd).toBeLessThanOrEqual(C.max_weight);
        expect(w.model).toBeGreaterThanOrEqual(1 - T.max_weight - C.max_weight - 1e-12);
        if (n < C.n_min) expect(w.crowd).toBe(0);
      }),
    );
  });

  it("flow weight never falls as volume grows", () => {
    fc.assert(
      fc.property(volume, volume, (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(tradedWeight(low)).toBeLessThanOrEqual(tradedWeight(high));
      }),
    );
  });

  it("with no flow and no crowd, R is the model mid exactly", () => {
    fc.assert(
      fc.property(lnLevel, fc.integer({ min: 0, max: C.n_min - 1 }), lnLevel, (m, n, crowd) => {
        const forward = blend({
          kind: "forward",
          model: m,
          traded: { value: m + 1, volumeUsd: 0 },
          crowd: { value: crowd, forecasters: n },
        });
        expect(forward.value).toBe(m);
        expect(forward.modelOnly).toBe(true);
        expect(forward.weights).toEqual({ model: 1, traded: 0, crowd: 0 });
      }),
    );
    fc.assert(
      fc.property(openProbability, (p) => {
        const binary = blend({ kind: "binary", model: p, traded: null, crowd: null });
        expect(binary.value).toBe(p);
        expect(binary.modelOnly).toBe(true);
      }),
    );
  });

  it("R lies between the smallest and largest component it weights", () => {
    fc.assert(
      fc.property(
        openProbability,
        probability,
        probability,
        volume,
        forecasters,
        (m, t, c, v, n) => {
          const result = blend({
            kind: "binary",
            model: m,
            traded: { value: t, volumeUsd: v },
            crowd: { value: c, forecasters: n },
          });
          const used = [m];
          if (result.weights.traded > 0) used.push(t);
          if (result.weights.crowd > 0) used.push(c);
          expect(result.value).toBeGreaterThanOrEqual(Math.min(...used) - 1e-12);
          expect(result.value).toBeLessThanOrEqual(Math.max(...used) + 1e-12);
        },
      ),
    );
  });
});
