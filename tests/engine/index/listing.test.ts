import { describe, expect, it } from "vitest";

import { consensusSeries } from "../../../src/lib/engine/index/consensus.js";
import { familyMarks } from "../../../src/lib/engine/index/families.js";
import { headlinePoint, isPrivateMark } from "../../../src/lib/engine/index/listing.js";
import { EXAMPLE_FAMILIES, EXAMPLE_ROWS, toFundMark } from "./example-rows.js";

describe("isPrivateMark", () => {
  it("cuts at the listing date: the day itself is listed", () => {
    // SpaceX's final prospectus (424B4 0001628280-26-042639) was filed 2026-06-12.
    expect(isPrivateMark("2026-05-31", "2026-06-12")).toBe(true);
    expect(isPrivateMark("2026-06-12", "2026-06-12")).toBe(false);
    expect(isPrivateMark("2026-06-30", "2026-06-12")).toBe(false);
    expect(isPrivateMark("2026-06-30", null)).toBe(true);
    expect(() => isPrivateMark("2026-6-30", null)).toThrow(RangeError);
  });
});

describe("headlinePoint", () => {
  function point(familySlug: string, securityLabel: string, asOf: string, mark: number) {
    return { familySlug, familyName: familySlug, securityLabel, asOf, markPerShareUsd: mark };
  }

  it("takes the latest as-of date with a consensus, not the latest date", () => {
    const points = consensusSeries(familyMarks(EXAMPLE_ROWS.map(toFundMark), EXAMPLE_FAMILIES));
    const headline = headlinePoint(points);
    // 2026-08-31 has two families, too few; 2026-07-31 has three.
    expect(headline).toMatchObject({ asOf: "2026-07-31", nFamilies: 3 });
    expect(headlinePoint(points.filter((entry) => entry.asOf !== "2026-07-31"))).toBeNull();
    expect(headlinePoint([])).toBeNull();
  });

  it("on that date, takes the label with the most families, then the higher consensus", () => {
    const points = consensusSeries([
      point("a", "Series A Preferred", "2026-08-31", 10),
      point("b", "Series A Preferred", "2026-08-31", 11),
      point("c", "Series A Preferred", "2026-08-31", 12),
      point("a", "Common", "2026-08-31", 5),
      point("b", "Common", "2026-08-31", 6),
      point("c", "Common", "2026-08-31", 7),
      point("d", "Common", "2026-08-31", 8),
      point("a", "Series B Preferred", "2026-09-30", 20),
      point("b", "Series B Preferred", "2026-09-30", 21),
    ]);
    expect(headlinePoint(points)).toMatchObject({ securityLabel: "Common", nFamilies: 4 });
    const tied = points.filter((entry) => entry.securityLabel !== "Common");
    expect(headlinePoint(tied)).toMatchObject({ securityLabel: "Series A Preferred" });
  });
});
