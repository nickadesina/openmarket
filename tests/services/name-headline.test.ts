import { describe, expect, it } from "vitest";

import { consensusSeries } from "../../src/lib/engine/index/consensus.js";
import { familyMarks } from "../../src/lib/engine/index/families.js";
import { headlinePoint } from "../../src/lib/engine/index/listing.js";
import { type MarksSummary, noHeadline } from "../../src/lib/services/index/get-name-index.js";
import { EXAMPLE_FAMILIES, EXAMPLE_ROWS, toFundMark } from "../engine/index/example-rows.js";

/**
 * Why a name has no headline, from the worked example's real rows
 * (tests/fixtures/index/anthropic-series-f1-2026.json): eight filings on
 * Anthropic Series F-1, three families as of 2026-07-31, two as of
 * 2026-08-31.
 */
const SUMMARY: MarksSummary = {
  live: 8,
  in_series: 8,
  no_per_share: 0,
  not_comparable_label: 0,
  after_listing: 0,
  latest_filed_on: "2026-10-30",
  latest_as_of: "2026-08-31",
};

const POINTS = consensusSeries(familyMarks(EXAMPLE_ROWS.map(toFundMark), EXAMPLE_FAMILIES));

describe("noHeadline", () => {
  it("is null when a date has three families", () => {
    expect(noHeadline(headlinePoint(POINTS), POINTS, SUMMARY, null)).toBeNull();
  });

  it("says how many families the best date has when none has three", () => {
    const withoutJuly = POINTS.filter((point) => point.asOf !== "2026-07-31");
    expect(noHeadline(headlinePoint(withoutJuly), withoutJuly, SUMMARY, null)).toEqual({
      code: "too_few_families",
      reason:
        "No as-of date has 3 families on one security; the most is 2 families (Series F-1 Preferred, 2026-08-31).",
    });
  });

  it("says when no live mark enters a series, and passes on why a name has no mark", () => {
    expect(noHeadline(null, [], { ...SUMMARY, in_series: 0 }, null)).toMatchObject({
      code: "no_per_share_series",
      reason: expect.stringMatching(/^8 live marks, none of them in a per-share series/),
    });
    const noMarks = { code: "not_searched", reason: "Not searched.", filings: [] } as const;
    expect(noHeadline(null, [], { ...SUMMARY, live: 0 }, noMarks)).toEqual({
      code: "no_marks",
      reason: "Not searched.",
    });
  });
});
