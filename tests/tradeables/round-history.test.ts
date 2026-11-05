import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { RULEBOOK_VERSION } from "../../src/lib/engine/rulebook.js";
import { parseCsv } from "../../src/lib/tradeables/csv.js";
import {
  DATA_THROUGH,
  EVENTS_CSV_PATH,
  MEGA_THRESHOLD_USD,
  ROUND_HISTORY_COLUMNS,
  renderRoundHistoryCsv,
  renderRoundHistoryJson,
  roundHistoryRows,
  SOURCES_CSV_PATH,
  tierOf,
} from "../../src/lib/tradeables/round-history.js";

/** events.csv's digest as v1's backtest/out/params.json recorded it (tag archive/dealer-v1). */
const PUBLISHED_EVENTS_SHA256 = "257c8789fa80ec234d653f2e86b4d8ef05362b4e97cb80a4aa171376239f6849";

const eventsCsv = readFileSync(EVENTS_CSV_PATH, "utf8");
const inputs = {
  eventsCsv,
  sourcesCsv: readFileSync(SOURCES_CSV_PATH, "utf8"),
  dataThrough: DATA_THROUGH,
  eventsSha256: createHash("sha256").update(eventsCsv).digest("hex"),
  megaThresholdUsd: MEGA_THRESHOLD_USD,
  rulebookVersion: RULEBOOK_VERSION,
};
const rows = roundHistoryRows(inputs);

describe("the round-history export", () => {
  it("reproduces the committed CSV and JSON byte for byte", () => {
    expect(renderRoundHistoryCsv(rows)).toBe(readFileSync("public/data/round-history.csv", "utf8"));
    expect(renderRoundHistoryJson(rows, inputs)).toBe(
      readFileSync("public/data/round-history.json", "utf8"),
    );
  });

  it("keeps every events.csv row, tenders included", () => {
    expect(rows).toHaveLength(parseCsv(inputs.eventsCsv).length);
    expect(rows).toHaveLength(64);
    expect(rows.filter((row) => row.event_type === "priced_round")).toHaveLength(59);
    expect(rows.some((row) => row.event_type === "tender_or_secondary")).toBe(true);
    expect(rows.filter((row) => row.source_url !== "")).toHaveLength(20);
  });

  it("never invents a source: a row without a URL has no rank or publisher", () => {
    for (const row of rows.filter((candidate) => candidate.source_url === "")) {
      expect(row.source_rank).toBe("");
      expect(row.publisher).toBe("");
    }
    const instinctSeed = rows.find(
      (row) => row.company === "Instinct" && row.round_name === "Seed",
    );
    expect(instinctSeed?.source_url).toBe("");
  });

  it("sets the tier from the previous priced round, empty for a first round", () => {
    const anduril = rows.filter((row) => row.company === "Anduril");
    expect(anduril.map((row) => row.tier_at_print)).toEqual(["", "redhot", "mega", "mega", "mega"]);
  });

  it("is sorted by company, then date", () => {
    const keys = rows.map((row) => `${row.company}\u0000${row.announcement_date}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("round-trips through a CSV reader with the published columns", () => {
    const parsed = parseCsv(renderRoundHistoryCsv(rows));
    expect(Object.keys(parsed[0]!)).toEqual([...ROUND_HISTORY_COLUMNS]);
    expect(parsed).toEqual(rows);
  });

  it("calls a last print of $10B or more mega", () => {
    expect(tierOf(10_000_000_000, MEGA_THRESHOLD_USD)).toBe("mega");
    expect(tierOf(9_999_999_999, MEGA_THRESHOLD_USD)).toBe("redhot");
    expect(() => tierOf(0, MEGA_THRESHOLD_USD)).toThrow(RangeError);
  });

  it("carries the digest and data date the dataset was published with, and the license", () => {
    const header = JSON.parse(renderRoundHistoryJson(rows, inputs)) as Record<string, unknown>;
    expect(header).toMatchObject({
      as_of: "2026-10-19",
      rows: 64,
      events_sha256: PUBLISHED_EVENTS_SHA256,
      rulebook_version: RULEBOOK_VERSION,
      license: "CC BY 4.0, cite OpenMarket",
    });
  });
});
