import { describe, expect, it } from "vitest";

import { downsampleMarks } from "../../src/lib/services/downsample-marks.js";

function point(minute: number, sequence: number, value = sequence) {
  return {
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    marketSequence: String(sequence),
    value,
  };
}

describe("downsampleMarks", () => {
  it("keeps first, last, and the final observation from every occupied bucket", () => {
    const points = Object.freeze([
      Object.freeze(point(0, 0)),
      Object.freeze(point(1, 1)),
      Object.freeze(point(2, 2)),
      Object.freeze(point(3, 3)),
      Object.freeze(point(8, 4)),
      Object.freeze(point(9, 5)),
      Object.freeze(point(10, 6)),
    ]);
    const before = structuredClone(points);

    const sampled = downsampleMarks(points, 4);

    expect(sampled).toEqual([points[0], points[3], points[5], points[6]]);
    expect(points).toEqual(before);
    expect(sampled[0]).not.toBe(points[0]);
  });

  it("preserves timestamp and sequence order when every timestamp ties", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const points = Array.from({ length: 8 }, (_, sequence) => ({
      timestamp,
      marketSequence: String(sequence),
      value: sequence / 10,
    }));

    expect(downsampleMarks(points, 5).map((entry) => entry.marketSequence)).toEqual([
      "0",
      "6",
      "7",
    ]);
  });

  it("rejects unordered tied observations and impossible bounds", () => {
    expect(() => downsampleMarks([point(0, 2), point(0, 1)], 2)).toThrow(/ordered/);
    expect(() => downsampleMarks([], 1)).toThrow(/at least 2/);
  });
});
