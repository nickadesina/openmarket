import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  consensusSeries,
  consensusUsd,
  dispersionPct,
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

  it("makes one point per as-of date, from each family's mark on exactly that date", () => {
    expect(series.map((item) => [item.asOf, item.nFamilies])).toEqual([
      ["2026-04-30", 1],
      ["2026-05-31", 1],
      ["2026-07-31", 3],
      ["2026-08-31", 2],
    ]);
    // Nothing is carried forward: T. Rowe Price's July mark is not in August's point.
    expect(series[3]!.families.map((mark) => mark.familySlug)).toEqual([
      "capital-group",
      "cik-707823",
    ]);
  });

  it("gives 2026-07-31's Series F-1 consensus from three families, dispersion near zero", () => {
    const july = series[2]!;
    expect(july.securityLabel).toBe("Series F-1 Preferred");
    expect(july.consensusUsd).toBeCloseTo(589.0095, 4);
    expect(july.dispersion!.pct).toBeLessThan(1e-5);
    expect(july.dispersion!.low.familyName).toBe("Franklin Strategic Series");
  });

  it("publishes no consensus or dispersion from two families", () => {
    const august = series[3]!;
    expect(august.consensusUsd).toBeNull();
    expect(august.dispersion).toBeNull();
    expect(august.families.map((mark) => mark.markPerShareUsd)).toEqual([751.32, 777.53]);
  });
});

describe("the comparison date", () => {
  it("never compares marks as of different dates", () => {
    const series = consensusSeries([
      point("a", "2026-07-31", 589.01),
      point("b", "2026-08-31", 751.32),
      point("c", "2026-08-31", 777.53),
      point("d", "2026-08-31", 789.39),
    ]);
    expect(series.map((item) => [item.asOf, item.nFamilies, item.consensusUsd])).toEqual([
      ["2026-07-31", 1, null],
      ["2026-08-31", 3, 777.53],
    ]);
    expect(series[1]!.dispersion!.pct).toBeCloseTo(((789.39 - 751.32) / 777.53) * 100, 10);
  });

  it("refuses two marks for one family, label and date", () => {
    expect(() =>
      consensusSeries([point("a", "2026-07-31", 10), point("a", "2026-07-31", 11)]),
    ).toThrow(RangeError);
  });
});

describe("consensusUsd", () => {
  it("is the median from three families, never a mean", () => {
    expect(consensusUsd([10, 12])).toBeNull();
    expect(consensusUsd([10, 12, 100])).toBe(12);
    expect(consensusUsd([10, 12, 14, 100])).toBe(13);
  });
});

describe("dispersion", () => {
  it("needs three families and a positive median", () => {
    expect(dispersionPct([10])).toBeNull();
    expect(dispersionPct([10, 12])).toBeNull();
    expect(dispersionPct([0, 0, 5])).toBeNull();
    expect(dispersionPct([10, 11, 12])).toBeCloseTo((2 / 11) * 100, 12);
    expect(consensusSeries([point("a", "2026-07-31", 10)])[0]!.dispersion).toBeNull();
  });

  it("names different high and low families when every mark is equal", () => {
    const [item] = consensusSeries([
      point("b", "2026-08-31", 10),
      point("a", "2026-08-31", 10),
      point("c", "2026-08-31", 10),
    ]);
    expect(item!.dispersion!.pct).toBe(0);
    expect(item!.dispersion!.low.familySlug).toBe("a");
    expect(item!.dispersion!.high.familySlug).toBe("c");
  });

  it("is scale invariant", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.01, max: 1e5, noNaN: true }), { minLength: 3, maxLength: 9 }),
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
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), { minLength: 3, maxLength: 8 }),
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
    const common = (slug: string, value: number) => ({
      ...point(slug, "2026-07-31", value),
      securityLabel: "Common",
    });
    const series = consensusSeries([
      point("a", "2026-07-31", 10),
      point("b", "2026-07-31", 11),
      point("c", "2026-07-31", 12),
      common("a", 5),
      common("b", 6),
      common("c", 7),
      { ...point("d", "2026-07-31", 99), securityLabel: "SPV interest" },
    ]);
    expect(series.map((item) => [item.securityLabel, item.consensusUsd])).toEqual([
      ["Common", 6],
      ["Series A Preferred", 11],
    ]);
  });

  it("does not mutate its input", () => {
    const marks = [point("b", "2026-07-31", 10), point("a", "2026-07-31", 12)];
    const before = structuredClone(marks);
    consensusSeries(marks);
    expect(marks).toEqual(before);
  });
});
