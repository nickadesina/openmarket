import { describe, expect, it } from "vitest";

import { downsampleMarks } from "../../src/lib/services/downsample-marks.js";

function point(minute: number, sequence: number, value = sequence) {
  return {
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    marketSequence: String(sequence),
    value,
  };
}

const HOUR = { start: Date.UTC(2026, 0, 1, 0, 0), end: Date.UTC(2026, 0, 1, 1, 0) };

describe("downsampleMarks", () => {
  it("keeps first, last, and each bucket's low and high in original order", () => {
    // Two 30-minute buckets. Bucket 0 spikes to 9 and reverts; bucket 1 dips to 1.
    const points = Object.freeze([
      Object.freeze(point(0, 0, 5)),
      Object.freeze(point(5, 1, 6)),
      Object.freeze(point(10, 2, 9)),
      Object.freeze(point(15, 3, 6)),
      Object.freeze(point(20, 4, 4)),
      Object.freeze(point(35, 5, 7)),
      Object.freeze(point(40, 6, 1)),
      Object.freeze(point(45, 7, 8)),
      Object.freeze(point(55, 8, 5)),
    ]);
    const before = structuredClone(points);

    const sampled = downsampleMarks(points, 6, HOUR);

    expect(sampled).toEqual([points[0], points[2], points[4], points[6], points[7], points[8]]);
    expect(points).toEqual(before);
    expect(sampled[0]).not.toBe(points[0]);
  });

  it("anchors buckets to the window, not the data extent", () => {
    // Same interior prints; a later last print must not shift which bucket they land in.
    const shared = [point(0, 0, 5), point(10, 1, 9), point(20, 2, 4), point(35, 3, 7)];
    const shortRun = downsampleMarks([...shared, point(40, 4, 5)], 6, HOUR);
    const longRun = downsampleMarks([...shared, point(59, 4, 5)], 6, HOUR);

    expect(shortRun.slice(0, -1)).toEqual(longRun.slice(0, -1));
  });

  it("clamps prints outside the window into the edge buckets", () => {
    const points = [
      point(-5, 0, 5),
      point(-2, 1, 9),
      point(30, 2, 1),
      point(65, 3, 8),
      point(70, 4, 5),
    ];

    expect(downsampleMarks(points, 6, HOUR).map((entry) => entry.marketSequence)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("keeps the later print when a bucket is flat", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const points = Array.from({ length: 8 }, (_, sequence) => ({
      timestamp,
      marketSequence: String(sequence),
      value: 0.5,
    }));

    expect(downsampleMarks(points, 6, HOUR).map((entry) => entry.marketSequence)).toEqual([
      "0",
      "1",
      "6",
      "7",
    ]);
  });

  it("falls back to endpoints when fewer than four points fit", () => {
    const points = [point(0, 0), point(1, 1), point(2, 2), point(3, 3)];

    expect(downsampleMarks(points, 3, HOUR)).toEqual([points[0], points[3]]);
  });

  it("rejects unordered tied observations and impossible bounds", () => {
    expect(() => downsampleMarks([point(0, 2), point(0, 1)], 2, HOUR)).toThrow(/ordered/);
    expect(() => downsampleMarks([], 1, HOUR)).toThrow(/at least 2/);
    expect(() => downsampleMarks([], 2, { start: 10, end: 5 })).toThrow(/window/);
  });
});
