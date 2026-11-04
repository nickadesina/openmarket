import { describe, expect, it } from "vitest";

import {
  type FundMarkInput,
  familyMarks,
  normalizeCik,
  parseFilerFamilies,
  resolveFamily,
} from "../../../src/lib/engine/index/families.js";
import { EXAMPLE_FAMILIES, EXAMPLE_ROWS, toFundMark } from "./example-rows.js";

const EMPTY = parseFilerFamilies({ version: "test", families: [] });

function fundMark(overrides: Partial<FundMarkInput> & Pick<FundMarkInput, "id">): FundMarkInput {
  return {
    filerCik: "1",
    filerName: "Registrant One",
    fundSeriesId: null,
    securityLabel: "Series A Preferred",
    asOf: "2026-06-30",
    markPerShareUsd: 10,
    ...overrides,
  };
}

describe("parseFilerFamilies", () => {
  it("returns a frozen copy and normalizes CIKs", () => {
    const input = {
      version: "1",
      families: [
        { slug: "one", name: "One", ciks: ["0000044201"], evidence: ["https://example.org"] },
      ],
    };
    const parsed = parseFilerFamilies(input);
    expect(parsed.families[0]!.ciks).toEqual(["44201"]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.families[0])).toBe(true);
    expect(input.families[0]!.ciks).toEqual(["0000044201"]);
  });

  it("refuses a CIK in two families, a duplicate slug, a reserved slug, or no evidence", () => {
    const family = (slug: string, ciks: string[], evidence: unknown = "why") => ({
      slug,
      name: slug,
      ciks,
      evidence,
    });
    expect(() =>
      parseFilerFamilies({ version: "1", families: [family("a", ["1"]), family("b", ["0001"])] }),
    ).toThrow(/both a and b/);
    expect(() =>
      parseFilerFamilies({ version: "1", families: [family("a", ["1"]), family("a", ["2"])] }),
    ).toThrow(RangeError);
    expect(() => parseFilerFamilies({ version: "1", families: [family("cik-1", ["1"])] })).toThrow(
      RangeError,
    );
    expect(() => parseFilerFamilies({ version: "1", families: [family("a", ["1"], "")] })).toThrow(
      RangeError,
    );
    expect(() => parseFilerFamilies({ version: "1", families: [family("A B", ["1"])] })).toThrow(
      RangeError,
    );
    expect(() => parseFilerFamilies({ version: "", families: [] })).toThrow(RangeError);
    expect(() => parseFilerFamilies(null)).toThrow(TypeError);
  });
});

describe("resolveFamily", () => {
  it("maps a listed registrant and defaults the rest to themselves", () => {
    expect(resolveFamily(EXAMPLE_FAMILIES, "0000719608", "New Economy Fund")).toEqual({
      slug: "capital-group",
      name: "Capital Group",
      mapped: true,
    });
    expect(
      resolveFamily(EXAMPLE_FAMILIES, "0000707823", "Fidelity Mt. Vernon Street Trust"),
    ).toEqual({ slug: "cik-707823", name: "Fidelity Mt. Vernon Street Trust", mapped: false });
  });

  it("refuses a malformed CIK", () => {
    expect(() => normalizeCik("12a")).toThrow(RangeError);
    expect(() => normalizeCik("0000")).toThrow(RangeError);
    expect(normalizeCik(" 0000044201 ")).toBe("44201");
  });
});

describe("familyMarks on the worked example", () => {
  const marks = familyMarks(EXAMPLE_ROWS.map(toFundMark), EXAMPLE_FAMILIES);

  it("folds Capital Group's two funds into one mark with no split", () => {
    const capital = marks.filter((mark) => mark.familySlug === "capital-group");
    expect(capital.map((mark) => mark.asOf)).toEqual(["2026-05-31", "2026-08-31"]);
    const august = capital[1]!;
    expect(august.nFunds).toBe(2);
    expect(august.markPerShareUsd).toBeCloseTo(751.32, 10);
    expect(august.intraFamilySplit).toBe(false);
    expect(august.markIds).toEqual([
      "0001193125-26-439060:S000009228",
      "0001193125-26-439062:S000009598",
    ]);
  });

  it("gives one mark per family, label and date, all on Series F-1 Preferred", () => {
    expect(marks).toHaveLength(7);
    expect(new Set(marks.map((mark) => mark.securityLabel))).toEqual(
      new Set(["Series F-1 Preferred"]),
    );
    const unmapped = marks.find((mark) => mark.familySlug === "cik-787441")!;
    expect(unmapped.familyName).toBe("NYLIM FUNDS");
    expect(unmapped.familyMapped).toBe(false);
  });
});

describe("familyMarks", () => {
  it("takes the median of funds and flags a split above the tolerance", () => {
    const marks = familyMarks(
      [
        fundMark({ id: "a", fundSeriesId: "S1", markPerShareUsd: 100 }),
        fundMark({ id: "b", fundSeriesId: "S2", markPerShareUsd: 100.05 }),
        fundMark({ id: "c", fundSeriesId: "S3", markPerShareUsd: 100.2 }),
      ],
      EMPTY,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]!.markPerShareUsd).toBe(100.05);
    expect(marks[0]!.intraFamilySplit).toBe(true);

    const within = familyMarks(
      [
        fundMark({ id: "a", fundSeriesId: "S1", markPerShareUsd: 100 }),
        fundMark({ id: "b", fundSeriesId: "S2", markPerShareUsd: 100.05 }),
      ],
      EMPTY,
    );
    expect(within[0]!.intraFamilySplit).toBe(false);
  });

  it("counts a fund once however many lots it holds", () => {
    const marks = familyMarks(
      [
        fundMark({ id: "a", fundSeriesId: "S1", markPerShareUsd: 100 }),
        fundMark({ id: "b", fundSeriesId: "S1", markPerShareUsd: 100 }),
        fundMark({ id: "c", fundSeriesId: "S2", markPerShareUsd: 200 }),
      ],
      EMPTY,
    );
    expect(marks[0]!.nFunds).toBe(2);
    expect(marks[0]!.markPerShareUsd).toBe(150);
  });

  it("leaves out rows without a per-share mark and labels that are not compared", () => {
    const marks = familyMarks(
      [
        fundMark({ id: "a", markPerShareUsd: null }),
        fundMark({ id: "b", securityLabel: "SPV interest" }),
        fundMark({ id: "c", securityLabel: "Unclassified" }),
        fundMark({ id: "d", securityLabel: "Warrant" }),
      ],
      EMPTY,
    );
    expect(marks).toEqual([]);
  });

  it("never pools labels or dates", () => {
    const marks = familyMarks(
      [
        fundMark({ id: "a", securityLabel: "Series A Preferred" }),
        fundMark({ id: "b", securityLabel: "Common" }),
        fundMark({ id: "c", asOf: "2026-09-30" }),
      ],
      EMPTY,
    );
    expect(marks).toHaveLength(3);
  });

  it("does not depend on input order, does not mutate it, and refuses bad rows", () => {
    const rows = EXAMPLE_ROWS.map(toFundMark);
    const before = structuredClone(rows);
    expect(familyMarks([...rows].reverse(), EXAMPLE_FAMILIES)).toEqual(
      familyMarks(rows, EXAMPLE_FAMILIES),
    );
    expect(rows).toEqual(before);
    expect(() => familyMarks([fundMark({ id: "a" }), fundMark({ id: "a" })], EMPTY)).toThrow(
      RangeError,
    );
    expect(() => familyMarks([fundMark({ id: "a", asOf: "2026-13-01" })], EMPTY)).toThrow(
      RangeError,
    );
    expect(() => familyMarks([fundMark({ id: "a", markPerShareUsd: -1 })], EMPTY)).toThrow(
      RangeError,
    );
  });
});
