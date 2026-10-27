import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { RULEBOOK } from "../../src/lib/engine/dealer/rulebook.js";
import {
  openMarketRow,
  renderResolutionSourcesMarkdown,
  resolutionSourceRowSchema,
  resolutionSources,
  resolutionSourcesFileSchema,
} from "../../src/lib/tradeables/resolution-sources.js";

const json: unknown = JSON.parse(readFileSync("docs/tradeables/resolution-sources.json", "utf8"));

const confirmed = {
  venue: "Example",
  product: "A product",
  launched: "2026-05",
  instrument: "binary",
  settlement_source: "A source",
  source_published: true,
  revision_window: null,
  void_rule: null,
  status: "live",
  notes: "A note.",
  sources: ["https://example.com/rule"],
  verified: "2026-10-26",
  needs_check: false,
};

describe("docs/tradeables/resolution-sources.json", () => {
  it("parses against the schema", () => {
    expect(() => resolutionSourcesFileSchema.parse(json)).not.toThrow();
  });

  it("refuses a confirmed row without a source URL", () => {
    expect(resolutionSourceRowSchema.safeParse({ ...confirmed, sources: [] }).success).toBe(false);
  });

  it("refuses a confirmed row without a verification date", () => {
    expect(resolutionSourceRowSchema.safeParse({ ...confirmed, verified: null }).success).toBe(
      false,
    );
  });

  it("accepts an unconfirmed row with neither, and keeps the field set exact", () => {
    expect(
      resolutionSourceRowSchema.safeParse({
        ...confirmed,
        sources: [],
        verified: null,
        needs_check: true,
      }).success,
    ).toBe(true);
    expect(resolutionSourceRowSchema.safeParse({ ...confirmed, extra: 1 }).success).toBe(false);
    const { void_rule: _omitted, ...missing } = confirmed;
    expect(resolutionSourceRowSchema.safeParse(missing).success).toBe(false);
  });

  it("refuses a non-https source", () => {
    expect(
      resolutionSourceRowSchema.safeParse({ ...confirmed, sources: ["http://example.com"] })
        .success,
    ).toBe(false);
  });

  it("never carries OpenMarket's row, which is computed", () => {
    const file = resolutionSourcesFileSchema.parse(json);
    expect(
      resolutionSourcesFileSchema.safeParse({
        ...file,
        rows: [...file.rows, { ...confirmed, venue: "OpenMarket" }],
      }).success,
    ).toBe(false);
  });
});

describe("OpenMarket's row", () => {
  it("is read from the rulebook", () => {
    const row = openMarketRow("2026-10-26");
    expect(resolutionSourceRowSchema.parse(row)).toEqual(row);
    expect(row.settlement_source).toContain(RULEBOOK.print.definition);
    for (const { source } of RULEBOOK.source_ranks) {
      expect(row.settlement_source.toLowerCase()).toContain(source.toLowerCase());
    }
    expect(row.revision_window).toContain(`${RULEBOOK.revision_window_days} days`);
    expect(row.void_rule).toBe(RULEBOOK.forward.void);
    expect(row.notes).toContain(`v${RULEBOOK.version}`);
  });

  it("comes last, after every row of the file", () => {
    const { file, rows } = resolutionSources();
    expect(rows).toHaveLength(file.rows.length + 1);
    expect(rows.at(-1)?.venue).toBe("OpenMarket");
  });
});

describe("the markdown export", () => {
  const markdown = renderResolutionSourcesMarkdown();

  it("is the committed docs/tradeables/resolution-sources.md", () => {
    expect(readFileSync("docs/tradeables/resolution-sources.md", "utf8")).toBe(markdown);
  });

  it("has a table row per venue, unverified rows marked, and no em-dash", () => {
    const { rows } = resolutionSources();
    for (const row of rows) {
      const name = row.needs_check ? `| ${row.venue} (unverified) |` : `| ${row.venue} |`;
      expect(markdown).toContain(name);
    }
    expect(markdown).not.toContain("—");
  });

  it("lists each source once", () => {
    const listed = markdown
      .split("## Sources")[1]!
      .split("\n")
      .filter((line) => /^\d+\. /.test(line))
      .map((line) => line.replace(/^\d+\. /, ""));
    expect(new Set(listed).size).toBe(listed.length);
  });
});
