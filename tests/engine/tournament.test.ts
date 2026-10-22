import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { aggregateForecasts, clampVector } from "../../src/lib/engine/tournament/aggregate.js";
import {
  assertValidBuckets,
  BucketError,
  binaryBuckets,
  bucketIndexForValue,
  choiceBuckets,
  floorIndex,
  numericBuckets,
} from "../../src/lib/engine/tournament/buckets.js";
import {
  canonicalProbs,
  ForecastError,
  normalizeForecast,
} from "../../src/lib/engine/tournament/forecast.js";
import { bucketMedian } from "../../src/lib/engine/tournament/median.js";
import {
  clampedFloorScore,
  pointLogScore,
  timeAveragedScore,
} from "../../src/lib/engine/tournament/score.js";

const PROPERTY_OPTIONS = { numRuns: 64, seed: 0x7041 } as const;
const ARR_EDGES = [66, 70, 74, 78, 83, 88, 94];
const arrBuckets = numericBuckets({
  edges: ARR_EDGES,
  floorLabel: "No public S-1 on EDGAR by Dec 31, 2026",
});

const vectorArb = (length: number) =>
  fc
    .array(fc.integer({ min: 0, max: 1_000 }), { minLength: length, maxLength: length })
    .filter((weights) => weights.some((weight) => weight > 0))
    .map((weights) => {
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      return weights.map((weight) => weight / total);
    });

describe("tournament buckets", () => {
  it("builds the S-1 ARR ladder with generated labels and a trailing floor", () => {
    expect(arrBuckets).toHaveLength(9);
    expect(arrBuckets.map((bucket) => bucket.label)).toEqual([
      "<66",
      "66–70",
      "70–74",
      "74–78",
      "78–83",
      "83–88",
      "88–94",
      ">94",
      "No public S-1 on EDGAR by Dec 31, 2026",
    ]);
    expect(floorIndex(arrBuckets)).toBe(8);
    expect(() => assertValidBuckets(arrBuckets, "numeric")).not.toThrow();
  });

  it("assigns lower-inclusive, upper-exclusive buckets", () => {
    expect(bucketIndexForValue(arrBuckets, 65.9)).toBe(0);
    expect(bucketIndexForValue(arrBuckets, 66)).toBe(1);
    expect(bucketIndexForValue(arrBuckets, 93.9)).toBe(6);
    expect(bucketIndexForValue(arrBuckets, 94)).toBe(7);
    expect(bucketIndexForValue(arrBuckets, 10_000)).toBe(7);
  });

  it("rejects non-increasing edges and malformed shapes", () => {
    expect(() => numericBuckets({ edges: [1, 1], floorLabel: "x" })).toThrow(BucketError);
    expect(() => numericBuckets({ edges: [2, 1], floorLabel: "x" })).toThrow(BucketError);
    expect(() => numericBuckets({ edges: [1], floorLabel: " " })).toThrow(BucketError);
    expect(() => assertValidBuckets(binaryBuckets(), "binary")).not.toThrow();
    expect(() => assertValidBuckets(binaryBuckets(), "numeric")).toThrow(BucketError);
    expect(() => assertValidBuckets(arrBuckets, "binary")).toThrow(BucketError);
    expect(() => assertValidBuckets(arrBuckets, "choice")).toThrow(BucketError);
    expect(() => assertValidBuckets(binaryBuckets(), "choice")).toThrow(BucketError);
  });

  it("builds choice buckets as named outcomes then the floor", () => {
    const buckets = choiceBuckets({ outcomes: ["A first", "B first"], floorLabel: "Neither" });
    expect(buckets.map((bucket) => [bucket.kind, bucket.label])).toEqual([
      ["range", "A first"],
      ["range", "B first"],
      ["floor", "Neither"],
    ]);
    expect(() => assertValidBuckets(buckets, "choice")).not.toThrow();
    expect(() => assertValidBuckets(buckets, "numeric")).toThrow(BucketError);
    expect(floorIndex(buckets)).toBe(2);
    expect(bucketMedian(buckets, [0.5, 0.3, 0.2])).toBeNull();
    expect(() => choiceBuckets({ outcomes: ["A"], floorLabel: "Neither" })).toThrow(BucketError);
    expect(() => choiceBuckets({ outcomes: ["A", "A"], floorLabel: "N" })).toThrow(BucketError);
    expect(() => choiceBuckets({ outcomes: ["A", "B"], floorLabel: " " })).toThrow(BucketError);
  });

  it("honours label overrides", () => {
    const buckets = numericBuckets({ edges: [1, 2], floorLabel: "None", labels: ["low"] });
    expect(buckets.map((bucket) => bucket.label)).toEqual(["low", "1–2", ">2", "None"]);
  });
});

describe("forecast normalization", () => {
  it("renormalizes within tolerance and rejects outside it", () => {
    const normalized = normalizeForecast([0.5, 0.5000005], 2);
    expect(normalized[0]! + normalized[1]!).toBeCloseTo(1, 9);
    expect(() => normalizeForecast([0.5, 0.51], 2)).toThrow(ForecastError);
    expect(() => normalizeForecast([1.1, -0.1], 2)).toThrow(ForecastError);
    expect(() => normalizeForecast([1], 2)).toThrow(ForecastError);
    expect(() => normalizeForecast([Number.NaN, 1], 2)).toThrow(ForecastError);
  });

  it("canonicalizes at fixed precision", () => {
    expect(canonicalProbs([0.25, 0.75])).toBe("0.2500000000,0.7500000000");
  });
});

describe("time-averaged log score", () => {
  const window = { opensAt: 0, closesAt: 1_000 };

  it("scores uniform as 0 and certainty as 100", () => {
    expect(pointLogScore(1 / 9, 9)).toBeCloseTo(0, 12);
    expect(pointLogScore(1, 9)).toBeCloseTo(100, 12);
    expect(clampedFloorScore(9)).toBeCloseTo((100 * Math.log(9 * 0.001)) / Math.log(9), 12);
    expect(clampedFloorScore(9)).toBeLessThan(-200);
  });

  it("treats time before the first submission as uniform and reports coverage", () => {
    const result = timeAveragedScore({
      bucketCount: 2,
      winningIndex: 0,
      ...window,
      forecasts: [{ at: 500, probs: [1, 0] }],
    })!;
    expect(result.timeAvgLogScore).toBeCloseTo(50, 9);
    expect(result.finalLogScore).toBeCloseTo(100, 9);
    expect(result.coverage).toBeCloseTo(0.5, 12);
  });

  it("sums piecewise-constant segments between revisions and ignores out-of-window events", () => {
    const result = timeAveragedScore({
      bucketCount: 2,
      winningIndex: 1,
      ...window,
      forecasts: [
        { at: 750, probs: [0, 1] },
        { at: 0, probs: [0.5, 0.5] },
        { at: 1_000, probs: [1, 0] },
      ],
    })!;
    // 750 ms at uniform (0) then 250 ms certain and right (100).
    expect(result.timeAvgLogScore).toBeCloseTo(25, 9);
    expect(result.finalLogScore).toBeCloseTo(100, 9);
    expect(result.coverage).toBe(1);
  });

  it("returns null without an in-window submission", () => {
    expect(
      timeAveragedScore({ bucketCount: 2, winningIndex: 0, ...window, forecasts: [] }),
    ).toBeNull();
  });

  it("stays between the clamp and 100", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 999 }), vectorArb(9)), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.integer({ min: 0, max: 8 }),
        (events, winningIndex) => {
          const result = timeAveragedScore({
            bucketCount: 9,
            winningIndex,
            ...window,
            forecasts: events.map(([at, probs]) => ({ at, probs })),
          })!;
          expect(result.timeAvgLogScore).toBeLessThanOrEqual(100 + 1e-9);
          expect(result.timeAvgLogScore).toBeGreaterThanOrEqual(clampedFloorScore(9) - 1e-9);
          expect(result.coverage).toBeGreaterThan(0);
          expect(result.coverage).toBeLessThanOrEqual(1);
        },
      ),
      PROPERTY_OPTIONS,
    );
  });
});

describe("aggregate", () => {
  it("returns a forecaster's own clamped vector when alone at a = 1", () => {
    const aggregate = aggregateForecasts([[0, 0.3, 0.7]], 1)!;
    const expected = clampVector([0, 0.3, 0.7]);
    aggregate.forEach((probability, index) => {
      expect(probability).toBeCloseTo(expected[index]!, 12);
    });
  });

  it("extremizes agreement", () => {
    const vector = [0.7, 0.3];
    const plain = aggregateForecasts([vector, vector], 1)!;
    const extremized = aggregateForecasts([vector, vector], 1.5)!;
    expect(plain[0]).toBeCloseTo(0.7, 9);
    expect(extremized[0]!).toBeGreaterThan(0.7);
  });

  it("is symmetric in the order of forecasters and always a distribution", () => {
    fc.assert(
      fc.property(fc.array(vectorArb(11), { minLength: 1, maxLength: 12 }), (vectors) => {
        const forward = aggregateForecasts(vectors)!;
        const reversed = aggregateForecasts([...vectors].reverse())!;
        expect(forward.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 12);
        forward.forEach((probability, index) => {
          expect(probability).toBeGreaterThan(0);
          expect(probability).toBeCloseTo(reversed[index]!, 12);
        });
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("is null for nobody", () => {
    expect(aggregateForecasts([])).toBeNull();
  });
});

describe("bucket median", () => {
  it("interpolates log-linearly inside the crossing bucket with the floor excluded", () => {
    // Range mass 0.8 renormalizes to 0.25 / 0.125 / 0.25 / 0.375; the floor is ignored,
    // so 0.375 lies below 74 and the crossing is halfway through 74–78.
    const probs = [0, 0.2, 0.1, 0.2, 0.3, 0, 0, 0, 0.2];
    const median = bucketMedian(arrBuckets, probs)!;
    expect(median.position).toBe("within");
    expect(median.value).toBeCloseTo(Math.sqrt(74 * 78), 9);
  });

  it("reports the inner edge of an open-ended crossing bucket", () => {
    expect(bucketMedian(arrBuckets, [0.9, 0.1, 0, 0, 0, 0, 0, 0, 0])).toEqual({
      value: 66,
      position: "below",
    });
    expect(bucketMedian(arrBuckets, [0, 0, 0, 0, 0, 0, 0.1, 0.5, 0.4])).toEqual({
      value: 94,
      position: "above",
    });
  });

  it("is null for a binary or when all mass is on the floor", () => {
    expect(bucketMedian(binaryBuckets(), [0.5, 0.5])).toBeNull();
    expect(bucketMedian(arrBuckets, [0, 0, 0, 0, 0, 0, 0, 0, 1])).toBeNull();
  });

  it("is monotone between the first and last edges", () => {
    fc.assert(
      fc.property(vectorArb(9), (probs) => {
        const median = bucketMedian(arrBuckets, probs);
        if (median === null) return;
        expect(median.value).toBeGreaterThanOrEqual(66);
        expect(median.value).toBeLessThanOrEqual(94);
      }),
      PROPERTY_OPTIONS,
    );
  });
});

describe("launch question set", async () => {
  const { LAUNCH_QUESTIONS } = await import("../../src/lib/config/tournament-questions.js");
  const { questionInputSchema } = await import("../../src/lib/api/tournament-schemas.js");

  it("parses, tiles, and matches the spec's bucket counts and closes", () => {
    const counts: Record<string, number> = {};
    for (const launch of LAUNCH_QUESTIONS) {
      const input = questionInputSchema.parse({ ...launch, opens_at: "2026-10-20T00:00:00Z" });
      if (input.unit === "bool") {
        assertValidBuckets(binaryBuckets(), "binary");
        counts[input.slug] = 2;
      } else if (input.unit === "choice") {
        const buckets = choiceBuckets({
          outcomes: input.outcomes.labels,
          floorLabel: input.outcomes.floor_label,
        });
        assertValidBuckets(buckets, "choice");
        counts[input.slug] = buckets.length;
      } else {
        const buckets = numericBuckets({
          edges: input.buckets.edges,
          floorLabel: input.buckets.floor_label,
          ...(input.buckets.labels === undefined ? {} : { labels: input.buckets.labels }),
        });
        assertValidBuckets(buckets, "numeric");
        counts[input.slug] = buckets.length;
      }
    }
    expect(counts).toEqual({
      "anthropic-ipo-day1-mcap": 7,
      "openai-round-vs-anthropic-ipo": 3,
    });
    // 23:59 Pacific Standard Time is 07:59 UTC the next day.
    expect(LAUNCH_QUESTIONS.map((question) => question.closes_at)).toEqual([
      "2027-01-01T07:59:00Z",
      "2027-01-01T07:59:00Z",
    ]);
  });
});
