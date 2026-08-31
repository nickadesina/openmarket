import { describe, expect, it } from "vitest";

import { calculateTimeWeightedAverage } from "../../src/lib/engine/twap.js";
import type { OrderedMark } from "../../src/lib/engine/types.js";

describe("calculateTimeWeightedAverage", () => {
  it("uses a 60-minute window by default", () => {
    const result = calculateTimeWeightedAverage({
      priorMark: {
        marketSequence: 1,
        timestamp: new Date("2026-01-01T10:30:00.000Z"),
        value: 10,
      },
      marks: [
        {
          marketSequence: 2,
          timestamp: new Date("2026-01-01T11:15:00.000Z"),
          value: 20,
        },
        {
          marketSequence: 3,
          timestamp: new Date("2026-01-01T11:45:00.000Z"),
          value: 40,
        },
      ],
      currentMetric: 40,
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    expect(result).toBeCloseTo(22.5, 12);
  });

  it("uses market sequence as the authoritative tie-break and does not mutate marks", () => {
    const laterSequence: OrderedMark = {
      marketSequence: 3,
      timestamp: new Date("2026-01-01T11:30:00.000Z"),
      value: 30,
    };
    const earlierSequence: OrderedMark = {
      marketSequence: 2,
      timestamp: new Date("2026-01-01T11:30:00.000Z"),
      value: 20,
    };
    const marks = [laterSequence, earlierSequence];

    const result = calculateTimeWeightedAverage({
      priorMark: {
        marketSequence: 1,
        timestamp: new Date("2026-01-01T10:00:00.000Z"),
        value: 10,
      },
      marks,
      currentMetric: 30,
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    expect(result).toBeCloseTo(20, 12);
    expect(marks).toEqual([laterSequence, earlierSequence]);
    expect(marks[0]).toBe(laterSequence);
    expect(marks[1]).toBe(earlierSequence);
  });

  it("supports an explicit averaging window", () => {
    const result = calculateTimeWeightedAverage({
      priorMark: {
        marketSequence: 4,
        timestamp: new Date("2026-01-01T11:20:00.000Z"),
        value: 2,
      },
      marks: [
        {
          marketSequence: 5,
          timestamp: new Date("2026-01-01T11:45:00.000Z"),
          value: 4,
        },
      ],
      currentMetric: 4,
      now: new Date("2026-01-01T12:00:00.000Z"),
      windowMs: 30 * 60 * 1_000,
    });

    expect(result).toBeCloseTo(3, 12);
  });

  it("returns the current metric when no trade occurred inside the window", () => {
    const result = calculateTimeWeightedAverage({
      priorMark: {
        marketSequence: 8,
        timestamp: new Date("2026-01-01T10:00:00.000Z"),
        value: 10,
      },
      marks: [],
      currentMetric: 99,
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    expect(result).toBe(99);
  });

  it("returns the current metric when an observation has no usable duration", () => {
    const result = calculateTimeWeightedAverage({
      priorMark: null,
      marks: [
        {
          marketSequence: 1,
          timestamp: new Date("2026-01-01T12:00:00.000Z"),
          value: 25,
        },
      ],
      currentMetric: 25,
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    expect(result).toBe(25);
  });

  it("rejects invalid timestamps, sequences, metrics, and windows", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");

    expect(() =>
      calculateTimeWeightedAverage({
        priorMark: null,
        marks: [],
        currentMetric: Number.NaN,
        now,
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateTimeWeightedAverage({
        priorMark: null,
        marks: [],
        currentMetric: 1,
        now: new Date(Number.NaN),
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateTimeWeightedAverage({
        priorMark: null,
        marks: [],
        currentMetric: 1,
        now,
        windowMs: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateTimeWeightedAverage({
        priorMark: null,
        marks: [
          {
            marketSequence: 1.5,
            timestamp: new Date("2026-01-01T11:30:00.000Z"),
            value: 1,
          },
        ],
        currentMetric: 1,
        now,
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateTimeWeightedAverage({
        priorMark: null,
        marks: [
          {
            marketSequence: 1,
            timestamp: new Date("2026-01-01T10:30:00.000Z"),
            value: 1,
          },
        ],
        currentMetric: 1,
        now,
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateTimeWeightedAverage({
        priorMark: {
          marketSequence: 1,
          timestamp: new Date("2026-01-01T11:30:00.000Z"),
          value: 1,
        },
        marks: [],
        currentMetric: 1,
        now,
      }),
    ).toThrow(RangeError);
  });
});
