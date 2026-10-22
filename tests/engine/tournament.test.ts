import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { aggregateBinary, aggregateForward } from "../../src/lib/engine/tournament/aggregate.js";
import {
  ForecastError,
  forecastCanonical,
  normalizeForecast,
} from "../../src/lib/engine/tournament/forecast.js";
import {
  binaryScore,
  CLAMP_SCORE,
  forwardScore,
  pointLogScore,
  SCORE_EPSILON,
  timeAveragedScore,
} from "../../src/lib/engine/tournament/score.js";

const normalizeProbability = (p: number) => normalizeForecast({ p }, "binary").p!;
const normalizeLevel = (value: number) => normalizeForecast({ value }, "forward").value!;

const PROPERTY_OPTIONS = { numRuns: 64, seed: 0x7041 } as const;

const probabilityArb = fc.integer({ min: 1, max: 999 }).map((permille) => permille / 1_000);
const levelArb = fc.double({ min: 0.01, max: 10_000, noNaN: true });

describe("forward score", () => {
  it("scores exact 100, 10% off about 86, 2× off 0, 4× off −100, either side", () => {
    expect(forwardScore(412, 412)).toBe(100);
    expect(forwardScore(1.1, 1)).toBeCloseTo(86.25, 2);
    expect(forwardScore(1, 1.1)).toBeCloseTo(86.25, 2);
    expect(forwardScore(1.5, 1)).toBeCloseTo(41.5, 1);
    expect(forwardScore(2, 1)).toBeCloseTo(0, 12);
    expect(forwardScore(0.5, 1)).toBeCloseTo(0, 12);
    expect(forwardScore(4, 1)).toBeCloseTo(-100, 12);
    expect(forwardScore(0.25, 1)).toBeCloseTo(-100, 12);
  });

  it("floors at the binary clamp, about −896.6, past a 1/ε = 1000× miss", () => {
    expect(CLAMP_SCORE).toBeCloseTo(-896.578, 3);
    expect(CLAMP_SCORE).toBe(pointLogScore(0.001, 2));
    expect(forwardScore(999, 1)).toBeGreaterThan(CLAMP_SCORE);
    expect(forwardScore(1_001, 1)).toBe(CLAMP_SCORE);
    expect(forwardScore(1e-9, 1)).toBe(CLAMP_SCORE);
  });

  it("is symmetric in log space and bounded", () => {
    fc.assert(
      fc.property(levelArb, levelArb, (x, y) => {
        const score = forwardScore(x, y);
        expect(score).toBeLessThanOrEqual(100);
        expect(score).toBeGreaterThanOrEqual(CLAMP_SCORE);
        expect(forwardScore(y, x)).toBeCloseTo(score, 9);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("refuses a non-positive level", () => {
    expect(() => forwardScore(0, 1)).toThrow(RangeError);
    expect(() => forwardScore(1, -1)).toThrow(RangeError);
  });
});

describe("binary score", () => {
  it("is the n = 2 log score, unchanged", () => {
    // The numbers the bucket engine gave a [p, 1 − p] vector on bucket 0 or 1.
    expect(binaryScore(0.5, "yes")).toBeCloseTo(0, 12);
    expect(binaryScore(1, "yes")).toBeCloseTo(100, 12);
    expect(binaryScore(0.7, "yes")).toBe(pointLogScore(0.7, 2));
    expect(binaryScore(0.7, "no")).toBe(pointLogScore(1 - 0.7, 2));
    expect(binaryScore(0.7, "yes")).toBeCloseTo(48.542682717024164, 12);
    expect(binaryScore(0.7, "no")).toBeCloseTo(-73.69655941662062, 12);
    expect(binaryScore(1, "no")).toBe(CLAMP_SCORE);
  });
});

describe("time-averaged score", () => {
  const window = { opensAt: 0, closesAt: 1_000 };
  const yes = (p: number) => binaryScore(p, "yes");

  it("counts time before the first submission as 0 and reports coverage", () => {
    const result = timeAveragedScore({
      ...window,
      forecasts: [{ at: 500, forecast: 1 }],
      score: yes,
    })!;
    expect(result.timeAvgLogScore).toBeCloseTo(50, 9);
    expect(result.finalLogScore).toBeCloseTo(100, 9);
    expect(result.coverage).toBeCloseTo(0.5, 12);
  });

  it("sums piecewise-constant segments between revisions and ignores out-of-window events", () => {
    const result = timeAveragedScore({
      ...window,
      forecasts: [
        { at: 750, forecast: 0 },
        { at: 0, forecast: 0.5 },
        { at: 1_000, forecast: 1 },
      ],
      score: (p: number) => binaryScore(p, "no"),
    })!;
    // 750 ms at 50% (0) then 250 ms certain and right (100).
    expect(result.timeAvgLogScore).toBeCloseTo(25, 9);
    expect(result.finalLogScore).toBeCloseTo(100, 9);
    expect(result.coverage).toBe(1);
  });

  it("averages a forward's levels the same way", () => {
    const result = timeAveragedScore({
      ...window,
      forecasts: [
        { at: 0, forecast: 2 },
        { at: 500, forecast: 1 },
      ],
      score: (x: number) => forwardScore(x, 1),
    })!;
    expect(result.timeAvgLogScore).toBeCloseTo(50, 9);
    expect(result.finalLogScore).toBe(100);
  });

  it("returns null without an in-window submission", () => {
    expect(timeAveragedScore({ ...window, forecasts: [], score: yes })).toBeNull();
  });

  it("stays between the clamp and 100", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 999 }), levelArb), {
          minLength: 1,
          maxLength: 8,
        }),
        levelArb,
        (events, settled) => {
          const result = timeAveragedScore({
            ...window,
            forecasts: events.map(([at, forecast]) => ({ at, forecast })),
            score: (x: number) => forwardScore(x, settled),
          })!;
          expect(result.timeAvgLogScore).toBeLessThanOrEqual(100 + 1e-9);
          expect(result.timeAvgLogScore).toBeGreaterThanOrEqual(CLAMP_SCORE - 1e-9);
          expect(result.coverage).toBeGreaterThan(0);
          expect(result.coverage).toBeLessThanOrEqual(1);
        },
      ),
      PROPERTY_OPTIONS,
    );
  });
});

describe("aggregate", () => {
  it("pools a binary as σ(a · mean logit), clamped, with no renormalization", () => {
    expect(aggregateBinary([0.7], 1)).toBeCloseTo(0.7, 12);
    expect(aggregateBinary([0], 1)).toBeCloseTo(SCORE_EPSILON, 12);
    const logit = (p: number) => Math.log(p / (1 - p));
    const expected = 1 / (1 + Math.exp(-1.5 * ((logit(0.6) + logit(0.8)) / 2)));
    expect(aggregateBinary([0.6, 0.8])).toBeCloseTo(expected, 12);
    expect(aggregateBinary([0.7, 0.7], 1.5)!).toBeGreaterThan(0.7);
    expect(aggregateBinary([0.5, 0.5])).toBeCloseTo(0.5, 12);
  });

  it("matches the bucket engine's n = 2 aggregate", () => {
    // The vector aggregate on [p, 1 − p] pairs, as the old engine computed it.
    const old = (ps: number[], a: number) => {
      const logit = (p: number) => Math.log(p) - Math.log1p(-p);
      const yes = ps.reduce((sum, p) => sum + logit(p), 0) / ps.length;
      const raw = [1 / (1 + Math.exp(-a * yes)), 1 / (1 + Math.exp(a * yes))];
      return raw[0]! / (raw[0]! + raw[1]!);
    };
    fc.assert(
      fc.property(fc.array(probabilityArb, { minLength: 1, maxLength: 12 }), (ps) => {
        expect(aggregateBinary(ps, 1.5)).toBeCloseTo(old(ps, 1.5), 12);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("takes the median ln level for a forward, the mean of the middle two when even", () => {
    expect(aggregateForward([400])).toBeCloseTo(400, 9);
    expect(aggregateForward([100, 400, 1_000])).toBeCloseTo(400, 9);
    expect(aggregateForward([100, 400])).toBeCloseTo(200, 9);
    expect(aggregateForward([1, 4, 9, 1_000_000])).toBeCloseTo(6, 9);
  });

  it("is symmetric in the order of forecasters", () => {
    fc.assert(
      fc.property(
        fc.array(probabilityArb, { minLength: 1, maxLength: 12 }),
        fc.array(levelArb, { minLength: 1, maxLength: 12 }),
        (ps, levels) => {
          expect(aggregateBinary([...ps].reverse())).toBeCloseTo(aggregateBinary(ps)!, 12);
          expect(aggregateForward([...levels].reverse())).toBeCloseTo(aggregateForward(levels)!, 9);
        },
      ),
      PROPERTY_OPTIONS,
    );
  });

  it("is null for nobody", () => {
    expect(aggregateBinary([])).toBeNull();
    expect(aggregateForward([])).toBeNull();
  });
});

describe("forecast validation", () => {
  it("takes p strictly inside (0, 1) at 10 decimals", () => {
    expect(normalizeProbability(0.42)).toBe(0.42);
    expect(normalizeProbability(0.123456789012)).toBe(0.123456789);
    expect(() => normalizeProbability(0)).toThrow(ForecastError);
    expect(() => normalizeProbability(1)).toThrow(ForecastError);
    expect(() => normalizeProbability(1e-12)).toThrow(ForecastError);
    expect(() => normalizeProbability(Number.NaN)).toThrow(ForecastError);
  });

  it("takes a level above 0", () => {
    expect(normalizeLevel(412)).toBe(412);
    expect(() => normalizeLevel(0)).toThrow(ForecastError);
    expect(() => normalizeLevel(-1)).toThrow(ForecastError);
    expect(() => normalizeLevel(1e-12)).toThrow(ForecastError);
    expect(() => normalizeLevel(Number.POSITIVE_INFINITY)).toThrow(ForecastError);
  });

  it("takes the field the question's kind asks for", () => {
    expect(normalizeForecast({ p: 0.3 }, "binary")).toEqual({ p: 0.3, value: null });
    expect(normalizeForecast({ value: 1.8 }, "forward")).toEqual({ p: null, value: 1.8 });
    expect(() => normalizeForecast({ value: 1.8 }, "binary")).toThrow(ForecastError);
    expect(() => normalizeForecast({ p: 0.3 }, "forward")).toThrow(ForecastError);
  });
});

describe("canonical payload", () => {
  it("keeps a binary byte for byte the pre-013 [p, 1 − p] payload", () => {
    // What the bucket engine hashed for a two-bucket [0.42, 0.58] submission.
    expect(forecastCanonical({ p: 0.42, value: null })).toBe("0.4200000000,0.5800000000");
    expect(forecastCanonical({ p: 0.1234567891, value: null })).toBe("0.1234567891,0.8765432109");
    fc.assert(
      fc.property(probabilityArb, (p) => {
        // The old normalizer rounded each entry of the submitted pair.
        const old = [p, 1 - p]
          .map((entry) => (Math.round(entry * 1e10) / 1e10).toFixed(10))
          .join(",");
        expect(forecastCanonical({ p, value: null })).toBe(old);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("prefixes a forward and cannot collide with a vector", () => {
    expect(forecastCanonical({ p: null, value: 412 })).toBe("fwd:412.0000000000");
    expect(forecastCanonical({ p: null, value: 1.85 })).toBe("fwd:1.8500000000");
    expect(/^[0-9.,]+$/.test(forecastCanonical({ p: null, value: 412 }))).toBe(false);
  });

  it("hashes a legacy event from its archived vector", () => {
    expect(forecastCanonical({ p: null, value: null, archivedProbs: [0.2, 0.3, 0.5] })).toBe(
      "0.2000000000,0.3000000000,0.5000000000",
    );
  });

  it("is stable through the stored 10-decimal string", () => {
    fc.assert(
      fc.property(levelArb, probabilityArb, (level, p) => {
        const x = normalizeLevel(level);
        expect(forecastCanonical({ p: null, value: Number(x.toFixed(10)) })).toBe(
          forecastCanonical({ p: null, value: x }),
        );
        const q = normalizeProbability(p);
        expect(forecastCanonical({ p: Number(q.toFixed(10)), value: null })).toBe(
          forecastCanonical({ p: q, value: null }),
        );
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("needs exactly one of p, value and an archived vector", () => {
    expect(() => forecastCanonical({ p: null, value: null })).toThrow(ForecastError);
    expect(() => forecastCanonical({ p: 0.5, value: 1 })).toThrow(ForecastError);
    expect(() => forecastCanonical({ p: 0.5, value: null, archivedProbs: [0.5, 0.5] })).toThrow(
      ForecastError,
    );
  });
});

describe("launch question set", async () => {
  const { LAUNCH_QUESTIONS } = await import("../../src/lib/config/tournament-questions.js");
  const { questionInputSchema } = await import("../../src/lib/api/tournament-schemas.js");

  it("parses as the four questions of decision 0004 with their kinds and closes", () => {
    const parsed = LAUNCH_QUESTIONS.map((launch) =>
      questionInputSchema.parse({ ...launch, opens_at: "2026-10-20T00:00:00Z" }),
    );
    expect(
      parsed.map((input) => [input.slug, input.kind, input.kind === "forward" ? input.unit : null]),
    ).toEqual([
      ["anthropic-ipo-day1-mcap", "forward", "USD_T"],
      ["anthropic-424b-run-rate", "forward", "USD_B"],
      ["openai-round-before-anthropic-ipo", "binary", null],
      ["anthropic-first-trade-by-2026", "binary", null],
    ]);
    // 23:59 Pacific Standard Time is 07:59 UTC the next day.
    expect(parsed.map((input) => input.closes_at)).toEqual([
      "2027-01-01T07:59:00Z",
      "2027-02-01T07:59:00Z",
      "2027-01-01T07:59:00Z",
      "2027-01-01T07:59:00Z",
    ]);
  });

  it("writes no bucket or floor sentence, and a forward's no-figure case as a void", () => {
    for (const launch of LAUNCH_QUESTIONS) {
      const text = `${launch.description_md}\n${launch.rulebook_md}`;
      expect(text).not.toMatch(/bucket|floor/i);
      if (launch.kind === "forward") expect(launch.rulebook_md).toContain("nothing is scored");
    }
  });
});
