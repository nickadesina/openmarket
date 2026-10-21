/**
 * Listing anchors, read from the backtest's own files (README D10): a name's
 * anchor is its last `priced_round` in backtest/events.csv, and its source is
 * the backtest/data/sources.csv row for that round. Pure: callers pass the
 * files' text, so a test can hand it a fixture.
 */
export const EVENTS_CSV_PATH = "backtest/events.csv";
export const SOURCES_CSV_PATH = "backtest/data/sources.csv";

const SOURCE_COLUMNS = [
  "company",
  "round_name",
  "announcement_date",
  "source_url",
  "source_title",
  "publisher",
  "source_rank",
  "published_date",
  "verified_at",
] as const;

export interface AnchorSource {
  readonly url: string;
  readonly rank: 1 | 2 | 3 | 4 | null;
}

export interface ListingAnchor {
  readonly company: string;
  readonly roundName: string;
  /** YYYY-MM-DD, as events.csv records it. */
  readonly announcementDate: string;
  /** Whole or decimal dollars, as events.csv records it. */
  readonly postMoneyUsd: string;
  /** Null when sources.csv has no URL for this round; such a name is not listed. */
  readonly source: AnchorSource | null;
}

/** RFC 4180 records with a header row: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field !== "" || record.length > 0) records.push([...record, field]);
  const [header, ...rows] = records.filter((row) => row.some((value) => value !== ""));
  if (header === undefined) return [];
  return rows.map((row) => {
    if (row.length !== header.length) {
      throw new Error(`CSV row has ${row.length} fields; the header has ${header.length}`);
    }
    return Object.fromEntries(header.map((name, i) => [name, row[i]!]));
  });
}

function joinKey(company: string, roundName: string, announcementDate: string): string {
  return `${company}\u0000${roundName}\u0000${announcementDate}`;
}

function parseRank(value: string, where: string): AnchorSource["rank"] {
  if (value === "") return null;
  const rank = Number(value);
  if (rank !== 1 && rank !== 2 && rank !== 3 && rank !== 4) {
    throw new Error(`${where}: source_rank must be 1–4 or blank`);
  }
  return rank;
}

function parseSourceUrl(value: string, where: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${where}: source_url is not a URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${where}: source_url must be https`);
  return value;
}

/**
 * The best-ranked source per round. Rows without a URL are skipped; a blank
 * rank sorts after every ranked row.
 */
export function parseSources(text: string): ReadonlyMap<string, AnchorSource> {
  const rows = parseCsv(text);
  const header = rows[0] === undefined ? [] : Object.keys(rows[0]);
  const missing = SOURCE_COLUMNS.filter((column) => !header.includes(column));
  if (rows.length > 0 && missing.length > 0) {
    throw new Error(`sources.csv is missing columns: ${missing.join(", ")}`);
  }
  const best = new Map<string, AnchorSource>();
  rows.forEach((row, index) => {
    const url = row.source_url!.trim();
    if (url === "") return;
    const where = `sources.csv row ${index + 2}`;
    const source = { url: parseSourceUrl(url, where), rank: parseRank(row.source_rank!, where) };
    const key = joinKey(row.company!, row.round_name!, row.announcement_date!);
    const current = best.get(key);
    if (current === undefined || (source.rank ?? 5) < (current.rank ?? 5)) best.set(key, source);
  });
  return best;
}

/**
 * Each company's last priced round, joined to its source. A company with no
 * priced round in events.csv is an error; one with no source is returned with
 * `source: null` for the caller to refuse. `sourcesCsv` is null when the file
 * does not exist.
 */
export function listingAnchors(
  eventsCsv: string,
  sourcesCsv: string | null,
  companies: readonly string[],
): ListingAnchor[] {
  const sources = sourcesCsv === null ? new Map<string, AnchorSource>() : parseSources(sourcesCsv);
  const rounds = parseCsv(eventsCsv).filter((row) => row.event_type === "priced_round");
  return companies.map((company) => {
    const last = rounds
      .filter((row) => row.company === company)
      .sort((a, b) => a.announcement_date!.localeCompare(b.announcement_date!))
      .at(-1);
    if (last === undefined) throw new Error(`events.csv has no priced_round for ${company}`);
    const postMoneyUsd = last.post_money_usd!;
    if (!/^\d+(\.\d+)?$/.test(postMoneyUsd) || Number(postMoneyUsd) <= 0) {
      throw new Error(`events.csv: ${company} ${last.round_name} has no post-money`);
    }
    return {
      company,
      roundName: last.round_name!,
      announcementDate: last.announcement_date!,
      postMoneyUsd,
      source: sources.get(joinKey(company, last.round_name!, last.announcement_date!)) ?? null,
    };
  });
}
