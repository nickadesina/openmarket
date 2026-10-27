import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import params from "../../backtest/out/params.json";
import { DEALER_PARAMS } from "../../src/lib/config/dealer.js";
import { parseCsv } from "../../src/lib/config/listing-anchors.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/dealer/rulebook.js";
import {
  ROUND_HISTORY_COLUMNS,
  renderRoundHistoryCsv,
  renderRoundHistoryJson,
  roundHistoryRows,
} from "../../src/lib/tradeables/round-history.js";

const inputs = {
  eventsCsv: readFileSync("backtest/events.csv", "utf8"),
  sourcesCsv: readFileSync("backtest/data/sources.csv", "utf8"),
  dataThrough: params.data_through,
  eventsSha256: params.inputs_sha256["events.csv"],
  megaThresholdUsd: DEALER_PARAMS.tier.mega_threshold_usd,
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

  it("carries the digest and data date from params.json, and the license", () => {
    const header = JSON.parse(renderRoundHistoryJson(rows, inputs)) as Record<string, unknown>;
    expect(header).toMatchObject({
      as_of: params.data_through,
      rows: 64,
      events_sha256: params.inputs_sha256["events.csv"],
      rulebook_version: RULEBOOK_VERSION,
      license: "CC BY 4.0, cite OpenMarket",
    });
  });
});
