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
  it("takes the latest quarter's label with the most families", () => {
    const points = consensusSeries(familyMarks(EXAMPLE_ROWS.map(toFundMark), EXAMPLE_FAMILIES));
    const headline = headlinePoint(points);
    expect(headline).not.toBeNull();
    const latest = points
      .map((point) => point.quarter)
      .sort()
      .at(-1);
    expect(headline!.quarter).toBe(latest);
    for (const point of points.filter((other) => other.quarter === latest)) {
      expect(headline!.nFamilies).toBeGreaterThanOrEqual(point.nFamilies);
    }
    expect(headlinePoint([])).toBeNull();
  });
});
