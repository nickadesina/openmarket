import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  assertIsoDate,
  calendarQuarter,
  daysBetween,
  lnRatio,
  median,
  perShareMark,
  quarterBounds,
} from "../../../src/lib/engine/index/mark.js";
import { EXAMPLE_ROWS } from "./example-rows.js";

const PROPERTY_OPTIONS = { numRuns: 200, seed: 0x1d3c } as const;

describe("perShareMark", () => {
  it("is value over balance for share-counted holdings, from a real filing", () => {
    const fidelity = EXAMPLE_ROWS.find((row) => row.accession === "0000035402-26-006778")!;
    expect(
      perShareMark({
        valueUsd: Number(fidelity.value_usd),
        balance: Number(fidelity.balance),
        units: fidelity.units,
      }),
    ).toBeCloseTo(777.53, 10);
  });

  it("is null for other units, a missing or non-positive balance, or a negative value", () => {
    expect(perShareMark({ valueUsd: 100, balance: 10, units: "PA" })).toBeNull();
    expect(perShareMark({ valueUsd: 100, balance: 10, units: "OU" })).toBeNull();
    expect(perShareMark({ valueUsd: 100, balance: 10, units: null })).toBeNull();
    expect(perShareMark({ valueUsd: 100, balance: null, units: "NS" })).toBeNull();
    expect(perShareMark({ valueUsd: 100, balance: 0, units: "NS" })).toBeNull();
    expect(perShareMark({ valueUsd: -100, balance: 10, units: "NS" })).toBeNull();
    expect(perShareMark({ valueUsd: 0, balance: 10, units: "NS" })).toBe(0);
  });

  it("refuses non-finite amounts", () => {
    expect(() => perShareMark({ valueUsd: Number.NaN, balance: 1, units: "NS" })).toThrow(
      RangeError,
    );
    expect(() =>
      perShareMark({ valueUsd: 1, balance: Number.POSITIVE_INFINITY, units: "NS" }),
    ).toThrow(RangeError);
  });
});

describe("dates and quarters", () => {
  it("buckets by calendar quarter", () => {
    expect(calendarQuarter("2026-07-31")).toBe("2026Q3");
    expect(calendarQuarter("2026-09-30")).toBe("2026Q3");
    expect(calendarQuarter("2026-10-01")).toBe("2026Q4");
    expect(calendarQuarter("2026-03-31")).toBe("2026Q1");
    expect(quarterBounds("2026Q3")).toEqual({ start: "2026-07-01", end: "2026-09-30" });
    expect(quarterBounds("2024Q1")).toEqual({ start: "2024-01-01", end: "2024-03-31" });
  });

  it("counts whole days", () => {
    expect(daysBetween("2026-07-31", "2026-08-31")).toBe(31);
    expect(daysBetween("2026-08-31", "2026-07-31")).toBe(-31);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
  });

  it("refuses anything but a real calendar date", () => {
    expect(() => assertIsoDate("2026-02-30", "asOf")).toThrow(RangeError);
    expect(() => assertIsoDate("2026-7-31", "asOf")).toThrow(RangeError);
    expect(() => assertIsoDate("2026-07-31T00:00:00Z", "asOf")).toThrow(RangeError);
    expect(() => calendarQuarter("not a date")).toThrow(RangeError);
    expect(() => quarterBounds("2026Q5")).toThrow(RangeError);
  });
});

describe("median", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow(RangeError);
    expect(() => median([1, Number.NaN])).toThrow(RangeError);
  });

  it("ignores order and never reorders its input", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 12 }),
        fc.nat(),
        (values, seed) => {
          const copy = [...values];
          const shuffled = [...values]
            .map((value, index) => ({ value, key: (index * 7919 + seed) % 104729 }))
            .sort((left, right) => left.key - right.key)
            .map(({ value }) => value);
          expect(median(shuffled)).toBe(median(values));
          expect(values).toEqual(copy);
        },
      ),
      PROPERTY_OPTIONS,
    );
  });
});

describe("lnRatio", () => {
  it("needs two positive values", () => {
    expect(lnRatio(Math.E, 1)).toBeCloseTo(1, 12);
    expect(() => lnRatio(0, 1)).toThrow(RangeError);
    expect(() => lnRatio(1, -1)).toThrow(RangeError);
  });
});
