import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  consensusSeries,
  dispersionPct,
  latestInQuarter,
} from "../../../src/lib/engine/index/consensus.js";
import { type FamilyMarkPoint, familyMarks } from "../../../src/lib/engine/index/families.js";
import { EXAMPLE_FAMILIES, EXAMPLE_ROWS, toFundMark } from "./example-rows.js";

const PROPERTY_OPTIONS = { numRuns: 200, seed: 0xd15 } as const;

function point(familySlug: string, asOf: string, markPerShareUsd: number): FamilyMarkPoint {
  return {
    familySlug,
    familyName: familySlug,
    securityLabel: "Series A Preferred",
    asOf,
    markPerShareUsd,
  };
}

describe("consensus on the worked example (METHODOLOGY.md)", () => {
  const series = consensusSeries(familyMarks(EXAMPLE_ROWS.map(toFundMark), EXAMPLE_FAMILIES));

  it("puts each family's latest mark in its calendar quarter", () => {
    expect(series.map((item) => item.quarter)).toEqual(["2026Q2", "2026Q3"]);
    const q2 = series[0]!;
    expect(q2.nFamilies).toBe(2);
    expect(q2.families.map((mark) => mark.asOf)).toEqual(["2026-05-31", "2026-04-30"]);
  });

  it("gives 2026Q3's Series F-1 consensus, five families, and 32.0 % dispersion", () => {
    const q3 = series[1]!;
    expect(q3.securityLabel).toBe("Series F-1 Preferred");
    expect(q3.quarterStart).toBe("2026-07-01");
    expect(q3.quarterEnd).toBe("2026-09-30");
    expect(q3.nFamilies).toBe(5);
    expect(q3.consensusUsd).toBeCloseTo(589.0095, 4);
    expect(q3.dispersion!.pct).toBeCloseTo(32.0064, 3);
    expect(q3.dispersion!.high.familyName).toBe("Fidelity Mt. Vernon Street Trust");
    expect(q3.dispersion!.high.markPerShareUsd).toBeCloseTo(777.53, 10);
    expect(q3.dispersion!.low.familyName).toBe("Franklin Strategic Series");
  });
});

describe("latestInQuarter", () => {
  it("keeps only the latest of a family's marks within one quarter", () => {
    const kept = latestInQuarter([
      point("a", "2026-07-31", 10),
      point("a", "2026-09-30", 11),
      point("a", "2026-10-31", 12),
    ]);
    expect(kept.map((mark) => mark.asOf)).toEqual(["2026-09-30", "2026-10-31"]);
  });

  it("refuses two marks for one family, label and date", () => {
    expect(() =>
      latestInQuarter([point("a", "2026-07-31", 10), point("a", "2026-07-31", 11)]),
    ).toThrow(RangeError);
  });
});

describe("dispersion", () => {
  it("needs two families and a positive median", () => {
    expect(dispersionPct([10])).toBeNull();
    expect(dispersionPct([0, 0, 5])).toBeNull();
    expect(dispersionPct([10, 12])).toBeCloseTo((2 / 11) * 100, 12);
    expect(consensusSeries([point("a", "2026-07-31", 10)])[0]!.dispersion).toBeNull();
  });

  it("names different high and low families when every mark is equal", () => {
    const [item] = consensusSeries([point("b", "2026-07-31", 10), point("a", "2026-08-31", 10)]);
    expect(item!.dispersion!.pct).toBe(0);
    expect(item!.dispersion!.low.familySlug).toBe("a");
    expect(item!.dispersion!.high.familySlug).toBe("b");
  });

  it("is scale invariant", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.01, max: 1e5, noNaN: true }), { minLength: 2, maxLength: 9 }),
        fc.double({ min: 1e-3, max: 1e3, noNaN: true }),
        (values, scale) => {
          const base = dispersionPct(values)!;
          const scaled = dispersionPct(values.map((value) => value * scale))!;
          expect(scaled).toBeCloseTo(base, 6);
        },
      ),
      PROPERTY_OPTIONS,
    );
  });

  it("ignores family order", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), { minLength: 2, maxLength: 8 }),
        (cents) => {
          const marks = cents.map((value, index) => point(`f${index}`, "2026-08-31", value / 100));
          const forward = consensusSeries(marks)[0]!;
          const backward = consensusSeries([...marks].reverse())[0]!;
          expect(backward).toEqual(forward);
        },
      ),
      PROPERTY_OPTIONS,
    );
  });
});

describe("consensusSeries", () => {
  it("never pools labels and skips labels that are not compared", () => {
    const series = consensusSeries([
      point("a", "2026-07-31", 10),
      { ...point("a", "2026-07-31", 5), securityLabel: "Common" },
      { ...point("b", "2026-07-31", 99), securityLabel: "SPV interest" },
    ]);
    expect(series.map((item) => [item.securityLabel, item.consensusUsd])).toEqual([
      ["Common", 5],
      ["Series A Preferred", 10],
    ]);
  });

  it("does not mutate its input", () => {
    const marks = [point("b", "2026-07-31", 10), point("a", "2026-07-31", 12)];
    const before = structuredClone(marks);
    consensusSeries(marks);
    expect(marks).toEqual(before);
  });
});
