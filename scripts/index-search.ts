/**
 * Week 1 of the index: which filers name each watchlist issuer and candidate.
 *
 *   SEC_USER_AGENT="OpenMarket-Index/0.1 (+https://openmarket.systems)" \
 *     npm run index:search [-- --since=2019-01-01] [--until=YYYY-MM-DD] [--issuer=slug] [--cache=<dir>]
 *
 * EDGAR full-text search over NPORT-P, N-CSR and N-CSRS (with amendments)
 * for every phrase in data/index/watchlist.json. Writes
 * data/index/filings-by-name.csv (one row per issuer and filing, fixed order)
 * and data/index/filer-counts.md (filings, registrants and families per
 * issuer, densest first, with the fetch time) and data/index/filing-counts.json
 * (the same counts as data, which the daily page reads to say why a name has
 * no filer marks). `--cache` keeps every response on disk for reruns
 * (development only). `--issuer` searches one name and prints its counts
 * without writing the outputs. `--recount` searches nothing: it reads
 * filings-by-name.csv back (with the fetch time and dates filer-counts.md
 * records) and rewrites the two counts files, after the watchlist or the
 * families file changes.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { withDiskCache } from "../src/lib/ingest/fetch/disk-cache.js";
import { createSecClient } from "../src/lib/ingest/fetch/sec.js";
import { familyLookup } from "../src/lib/ingest/parse/families.js";
import {
  FILER_COUNTS_PATH,
  FILING_COUNTS_PATH,
  FILINGS_CSV_PATH,
  loadFilerFamilies,
  loadWatchlist,
} from "../src/lib/services/index/data-files.js";
import {
  countsContextFromMarkdown,
  filerCountsMarkdown,
  filingCountsJson,
  filingsCsv,
  type IssuerSearch,
  issuerCounts,
  searchesFromCsv,
  searchIssuers,
} from "../src/lib/services/index/search-filings.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function writeCounts(
  searches: readonly IssuerSearch[],
  familyOf: (cik: string) => string,
  context: { fetchedAt: string; startDate: string; endDate: string; familiesVersion: string },
): void {
  const counts = issuerCounts(searches, familyOf);
  writeFileSync(FILER_COUNTS_PATH, filerCountsMarkdown(counts, context));
  writeFileSync(FILING_COUNTS_PATH, filingCountsJson(searches, counts, context));
  console.log(`wrote ${FILER_COUNTS_PATH} and ${FILING_COUNTS_PATH}`);
}

/** Rewrites the counts files from the CSV the last search wrote. */
function recount(): void {
  const context = countsContextFromMarkdown(readFileSync(FILER_COUNTS_PATH, "utf8"));
  if (context === null) throw new Error(`${FILER_COUNTS_PATH} does not record its fetch`);
  const families = loadFilerFamilies();
  const searches = searchesFromCsv(readFileSync(FILINGS_CSV_PATH, "utf8"), loadWatchlist().issuers);
  writeCounts(searches, familyLookup(families), {
    ...context,
    familiesVersion: families.version,
  });
}

async function main(): Promise<void> {
  if (process.argv.includes("--recount")) {
    recount();
    return;
  }
  const startDate = argument("since") ?? "2019-01-01";
  const endDate = argument("until") ?? new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    throw new Error("--since and --until take YYYY-MM-DD");
  }
  const only = argument("issuer");
  const cache = argument("cache");
  const secClient = createSecClient();
  const client = cache === undefined ? secClient : withDiskCache(secClient, cache);
  const watchlist = loadWatchlist();
  const issuers = watchlist.issuers.filter((issuer) => only === undefined || issuer.slug === only);
  if (issuers.length === 0) throw new Error(`no issuer ${only} in the watchlist`);
  const families = loadFilerFamilies();
  const familyOf = familyLookup(families);
  const fetchedAt = new Date().toISOString();

  const searches = await searchIssuers(client, issuers, {
    startDate,
    endDate,
    onProgress: (message) => console.log(message),
  });
  for (const count of issuerCounts(searches, familyOf)) {
    console.log(
      `${count.slug}: ${count.filings} filings, ${count.registrants} registrants, ${count.families} families`,
    );
  }
  if (only !== undefined) return;

  writeFileSync(FILINGS_CSV_PATH, filingsCsv(searches, familyOf));
  console.log(`wrote ${FILINGS_CSV_PATH}`);
  writeCounts(searches, familyOf, {
    fetchedAt,
    startDate,
    endDate,
    familiesVersion: families.version,
  });
}

try {
  await main();
} catch (error: unknown) {
  console.error("index:search failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
