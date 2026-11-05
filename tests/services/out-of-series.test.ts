import { describe, expect, it } from "vitest";

import {
  OUT_OF_SERIES_RECENT,
  outOfSeriesGroups,
  outOfSeriesReason,
} from "../../src/lib/services/index/get-name-index.js";

/**
 * How a name page publishes the live marks that enter no per-share series.
 * The base row is New Economy Fund's Epic Games holding as its N-PORT/A
 * filed it (tests/fixtures/index/nport-719608-000114554922028055.xml); each
 * test varies the label, date, filer or per-share mark to exercise one rule,
 * so the varied rows are inputs to the grouping, not filings.
 */
function row(
  id: string,
  overrides: Partial<{
    security_label: string;
    as_of: string;
    mark_per_share_usd: string | null;
    filer_cik: string | null;
    filer_name: string;
    filed_on: string | null;
  }>,
) {
  return {
    id,
    security_label: "Unclassified",
    as_of: "2022-02-28",
    mark_per_share_usd: "1095.70",
    holding_title: "EPIC GAMES INC PP (DRS) (NOT LISTED OR TRADING)",
    balance: "84438",
    value_usd: "92518716.60",
    source_class: "nport",
    accession: "0001145549-22-028055",
    document_url:
      "https://www.sec.gov/Archives/edgar/data/719608/000114554922028055/primary_doc.xml",
    filer_cik: "719608",
    filer_name: "NEW ECONOMY FUND",
    fund_series_id: "S000009598",
    fund_series_name: "New Economy Fund",
    filed_on: "2022-05-19",
    ...overrides,
  };
}

describe("out-of-series groups", () => {
  it("groups by reason and label, newest first, and leaves in-series rows out", () => {
    const groups = outOfSeriesGroups(
      [
        row("a", {}),
        row("b", { as_of: "2022-05-31", filed_on: "2022-07-27" }),
        row("c", { security_label: "Series F-1 Preferred" }),
        row("d", { security_label: "SPV interest", filer_cik: "707823", filer_name: "FIDELITY" }),
        row("e", { mark_per_share_usd: null, security_label: "Common" }),
      ],
      null,
    );
    expect(groups.map((group) => [group.status, group.security_label, group.n_marks])).toEqual([
      ["not_comparable_label", "Unclassified", 2],
      ["no_per_share", "Common", 1],
      ["not_comparable_label", "SPV interest", 1],
    ]);
    expect(groups[0]!.recent.map((mark) => [mark.mark_id, mark.as_of])).toEqual([
      ["b", "2022-05-31"],
      ["a", "2022-02-28"],
    ]);
    expect(groups[0]).toMatchObject({ n_filers: 1, latest_as_of: "2022-05-31" });
  });

  it("lists at most the newest few of a large group and counts the rest", () => {
    const rows = Array.from({ length: OUT_OF_SERIES_RECENT + 5 }, (_, index) =>
      row(`m${String(index).padStart(2, "0")}`, {}),
    );
    const [group] = outOfSeriesGroups(rows, null);
    expect(group!.n_marks).toBe(OUT_OF_SERIES_RECENT + 5);
    expect(group!.recent).toHaveLength(OUT_OF_SERIES_RECENT);
  });

  it("states the rule that keeps each group out", () => {
    expect(outOfSeriesReason("after_listing", "Common", "2026-06-12")).toContain("2026-06-12");
    expect(outOfSeriesReason("not_comparable_label", "Unclassified", null)).toContain(
      "names no security",
    );
    expect(outOfSeriesReason("not_comparable_label", "Warrant", null)).toContain(
      "One Warrant label covers",
    );
    expect(outOfSeriesReason("no_per_share", "Common", null)).toContain("not counted in shares");
  });

  it("keeps a listed name's marks from its listing date on out, as listed-stock marks", () => {
    const groups = outOfSeriesGroups(
      [
        row("x", { security_label: "Common", as_of: "2026-05-31" }),
        row("y", { security_label: "Common", as_of: "2026-06-30" }),
      ],
      "2026-06-12",
    );
    expect(groups).toEqual([
      expect.objectContaining({ status: "after_listing", n_marks: 1, latest_as_of: "2026-06-30" }),
    ]);
  });
});
