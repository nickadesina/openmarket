/**
 * Runs one ingest source against the database:
 *
 *   SEC_USER_AGENT="OpenMarket-Index/0.1 (+https://openmarket.systems)" \
 *     npm run index:ingest -- --source=nport|form_d [--since=YYYY-MM-DD] [--until=YYYY-MM-DD] [--issuer=slug,...] [--cache=<dir>] [--refetch]
 *
 * `--since` defaults to a week before the last ok run of the source (or
 * 2019-01-01 before the first); `--issuer` limits the run to those slugs
 * (candidates included); `--cache` keeps every EDGAR response on disk for
 * reruns (development only); `--refetch` (nport) reads every candidate
 * again, so holdings of an issuer whose pattern changed after its documents
 * were stored are found (rows already stored are not written twice).
 * `form_d` reads the watchlist file for each issuer's Form D phrases and
 * vehicle pattern, and the round-history files for print source ranks.
 * Run `npm run index:watchlist` first. Uses DATABASE_URL_UNPOOLED. Prints
 * the run's counts per issuer.
 */
import { readFileSync } from "node:fs";
import type { Kysely } from "kysely";
import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import type { Database } from "../src/lib/db/schema.js";
import { withDiskCache } from "../src/lib/ingest/fetch/disk-cache.js";
import type { SecClient } from "../src/lib/ingest/fetch/sec.js";
import { createSecClient } from "../src/lib/ingest/fetch/sec.js";
import { loadWatchlist } from "../src/lib/services/index/data-files.js";
import { printCandidates } from "../src/lib/services/index/import-prints.js";
import { ingestFormD, vehicleCounts } from "../src/lib/services/index/ingest-form-d.js";
import { ingestNport, loadIndexIssuers } from "../src/lib/services/index/ingest-nport.js";
import { incrementalSince } from "../src/lib/services/index/run-scheduled-ingest.js";
import { EVENTS_CSV_PATH, SOURCES_CSV_PATH } from "../src/lib/tradeables/round-history.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES = ["nport", "form_d"] as const;

async function runFormD(
  db: Kysely<Database>,
  client: SecClient,
  window: { since: string; until: string },
  issuerSlugs: readonly string[] | undefined,
): Promise<void> {
  const watchlist = new Map(loadWatchlist().issuers.map((issuer) => [issuer.slug, issuer]));
  const issuers = (await loadIndexIssuers(db, issuerSlugs)).map((issuer) => {
    const formD = watchlist.get(issuer.slug)?.formD;
    return formD === undefined ? issuer : { ...issuer, formD };
  });
  const { candidates } = printCandidates(
    readFileSync(EVENTS_CSV_PATH, "utf8"),
    readFileSync(SOURCES_CSV_PATH, "utf8"),
    issuers,
  );
  const ranks = new Map(
    candidates
      .filter((candidate) => candidate.sourceRank !== null)
      .map((candidate) => [
        `${candidate.issuerSlug}\u0000${candidate.roundName}`,
        candidate.sourceRank!,
      ]),
  );
  const report = await ingestFormD(db, client, {
    ...window,
    issuers,
    roundSourceRanks: ranks,
    log: (message) => console.log(message),
  });
  for (const [slug, counts] of Object.entries(report.perIssuer)) {
    console.log(
      `${slug}: ${counts.candidates} filings found, read now: ${counts.vehiclesMatched} vehicles matched, ${counts.vehiclesUnmatched} unmatched, ${counts.ownFilings} own, ${counts.notVehicles} neither`,
    );
  }
  for (const failure of report.failures.slice(0, 20)) {
    console.warn(`failed ${failure.url}: ${failure.reason}`);
  }
  console.log("stored vehicles (issuer, method, vehicles, filings):");
  for (const row of await vehicleCounts(db)) {
    console.log(
      `  ${row.issuer ?? "(unmatched)"} ${row.method}: ${row.vehicles} vehicles, ${row.filings} filings`,
    );
  }
  console.log(
    `run ${report.runId} ${report.status}: ${report.candidates} candidates, ${report.documentsNew} new, ${report.documentsSkipped} skipped, ${report.rematched} rematched, ${report.failures.length} failed${report.error === null ? "" : ` (${report.error})`}`,
  );
  if (report.status !== "ok") process.exitCode = 1;
}

async function main(): Promise<void> {
  const source = argument("source");
  if (!SOURCES.includes(source as (typeof SOURCES)[number])) {
    throw new Error(`--source must be one of: ${SOURCES.join(", ")}`);
  }
  const until = argument("until") ?? new Date().toISOString().slice(0, 10);
  const sinceArgument = argument("since");
  if ((sinceArgument !== undefined && !ISO_DATE.test(sinceArgument)) || !ISO_DATE.test(until)) {
    throw new Error("--since and --until take YYYY-MM-DD");
  }
  const issuerSlugs = argument("issuer")
    ?.split(",")
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
  const cache = argument("cache");
  const secClient = createSecClient();
  const client = cache === undefined ? secClient : withDiskCache(secClient, cache);
  const db = createDirectDatabase();
  try {
    if (source === "form_d") {
      const since = sinceArgument ?? (await incrementalSince(db, "form_d"));
      console.log(`form_d: filings ${since} to ${until}`);
      await runFormD(db, client, { since, until }, issuerSlugs);
      return;
    }
    const since = sinceArgument ?? (await incrementalSince(db, "nport"));
    console.log(`nport: filings ${since} to ${until}`);
    const report = await ingestNport(db, client, {
      since,
      until,
      ...(issuerSlugs === undefined ? {} : { issuerSlugs }),
      refetch: process.argv.includes("--refetch"),
      log: (message) => console.log(message),
    });
    for (const [slug, counts] of Object.entries(report.perIssuer)) {
      console.log(
        `${slug}: ${counts.documents} documents, ${counts.marks} new marks (${counts.perShareMarks} per share)`,
      );
    }
    const phraseOnly = new Map<string, number>();
    for (const { issuerSlug } of report.phraseOnly) {
      phraseOnly.set(issuerSlug, (phraseOnly.get(issuerSlug) ?? 0) + 1);
    }
    for (const [slug, count] of phraseOnly) {
      console.log(`${slug}: ${count} documents name it but no holding matches its pattern`);
    }
    for (const failure of report.failures.slice(0, 20)) {
      console.warn(`failed ${failure.url}: ${failure.reason}`);
    }
    console.log(
      `run ${report.runId} ${report.status}: ${report.candidates} candidates, ${report.documentsSeen} seen, ${report.documentsNew} new, ${report.documentsSkipped} skipped, ${report.marksNew} new marks, ${report.supersededNew} superseded, ${report.failures.length} failed${report.error === null ? "" : ` (${report.error})`}`,
    );
    if (report.status !== "ok") process.exitCode = 1;
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error("index:ingest failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
