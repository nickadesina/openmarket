/**
 * The checked-in inputs and outputs of ingest under data/index/, read by the
 * scripts from the working directory (the repository root). The cron job
 * reads issuers from the database, not these files.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type FilerFamilies, parseFilerFamiliesText } from "../../ingest/parse/families.js";
import { parseWatchlist, type Watchlist } from "../../ingest/parse/watchlist.js";

export const WATCHLIST_PATH = "data/index/watchlist.json";
export const FILER_FAMILIES_PATH = "data/index/filer-families.json";
export const FILINGS_CSV_PATH = "data/index/filings-by-name.csv";
export const FILER_COUNTS_PATH = "data/index/filer-counts.md";
export const FILING_COUNTS_PATH = "data/index/filing-counts.json";

export function loadWatchlist(root = process.cwd()): Watchlist {
  return parseWatchlist(readFileSync(join(root, WATCHLIST_PATH), "utf8"));
}

/** The families file, or an empty one (every CIK its own family) before it exists. */
export function loadFilerFamilies(root = process.cwd()): FilerFamilies {
  const path = join(root, FILER_FAMILIES_PATH);
  if (!existsSync(path)) return { version: "0.0.0", families: [] };
  return parseFilerFamiliesText(readFileSync(path, "utf8"));
}
