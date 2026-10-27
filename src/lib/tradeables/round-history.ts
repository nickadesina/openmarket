import { parseCsv } from "../config/listing-anchors.js";
import { tierOf } from "../engine/dealer/prior.js";
import { csvLine, pythonJson } from "./csv.js";

/**
 * The round-history dataset (docs/prompts/tradeables, item 2): every row of
 * backtest/events.csv joined to its source in backtest/data/sources.csv on
 * (company, round_name), with the tier the company's previous priced round
 * set (README D10), sorted by company then date. Values pass through as the
 * files record them. Pure: callers pass the files' text.
 */

export const ROUND_HISTORY_COLUMNS = [
  "company",
  "event_type",
  "round_name",
  "announcement_date",
  "post_money_usd",
  "amount_raised_usd",
  "lead",
  "tier_at_print",
  "source_url",
  "source_rank",
  "publisher",
  "leak_date",
  "leak_post_money_usd",
  "notes",
] as const;

export type RoundHistoryRow = Record<(typeof ROUND_HISTORY_COLUMNS)[number], string>;

export interface RoundHistoryInputs {
  readonly eventsCsv: string;
  readonly sourcesCsv: string;
  /** params.json `data_through`. */
  readonly dataThrough: string;
  /** params.json `inputs_sha256["events.csv"]`, so a stale export is visible. */
  readonly eventsSha256: string;
  readonly megaThresholdUsd: number;
  readonly rulebookVersion: string;
}

export const LICENSE = "CC BY 4.0, cite OpenMarket";

function field(record: Record<string, string>, name: string): string {
  const value = record[name];
  if (value === undefined) throw new Error(`CSV has no ${name} column`);
  return value;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function roundHistoryRows(inputs: RoundHistoryInputs): RoundHistoryRow[] {
  const sources = new Map<string, Record<string, string>>();
  for (const source of parseCsv(inputs.sourcesCsv)) {
    sources.set(`${field(source, "company")}\u0000${field(source, "round_name")}`, source);
  }
  const events = parseCsv(inputs.eventsCsv).sort(
    (left, right) =>
      compare(field(left, "company"), field(right, "company")) ||
      compare(field(left, "announcement_date"), field(right, "announcement_date")),
  );

  const lastPrint = new Map<string, number>();
  return events.map((event) => {
    const company = field(event, "company");
    const previous = lastPrint.get(company);
    if (field(event, "event_type") === "priced_round") {
      lastPrint.set(company, Number(field(event, "post_money_usd")));
    }
    const source = sources.get(`${company}\u0000${field(event, "round_name")}`);
    return {
      company,
      event_type: field(event, "event_type"),
      round_name: field(event, "round_name"),
      announcement_date: field(event, "announcement_date"),
      post_money_usd: field(event, "post_money_usd"),
      amount_raised_usd: field(event, "amount_raised_usd"),
      lead: field(event, "lead"),
      tier_at_print: previous === undefined ? "" : tierOf(previous, inputs.megaThresholdUsd),
      source_url: source === undefined ? "" : field(source, "source_url"),
      source_rank: source === undefined ? "" : field(source, "source_rank"),
      publisher: source === undefined ? "" : field(source, "publisher"),
      leak_date: field(event, "leak_date"),
      leak_post_money_usd: field(event, "leak_post_money_usd"),
      notes: field(event, "notes"),
    };
  });
}

export function renderRoundHistoryCsv(rows: readonly RoundHistoryRow[]): string {
  return [ROUND_HISTORY_COLUMNS, ...rows.map((row) => ROUND_HISTORY_COLUMNS.map((c) => row[c]))]
    .map(csvLine)
    .join("");
}

export function renderRoundHistoryJson(
  rows: readonly RoundHistoryRow[],
  inputs: RoundHistoryInputs,
): string {
  return pythonJson({
    as_of: inputs.dataThrough,
    rows: rows.length,
    events_sha256: inputs.eventsSha256,
    rulebook_version: inputs.rulebookVersion,
    license: LICENSE,
    columns: ROUND_HISTORY_COLUMNS,
    data: rows,
  });
}
