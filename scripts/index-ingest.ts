/**
 * Runs one ingest source against the database:
 *
 *   SEC_USER_AGENT="OpenMarket-Index/0.1 (+https://openmarket.systems)" \
 *     npm run index:ingest -- --source=nport [--since=YYYY-MM-DD] [--until=YYYY-MM-DD] [--issuer=slug,...] [--cache=<dir>]
 *
 * `--since` defaults to a week before the last ok run of the source (or
 * 2019-01-01 before the first); `--issuer` limits the run to those slugs
 * (candidates included); `--cache` keeps every EDGAR response on disk for
 * reruns (development only). Run `npm run index:watchlist` first. Uses
 * DATABASE_URL_UNPOOLED. Prints the run's counts per issuer.
 */
import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { withDiskCache } from "../src/lib/ingest/fetch/disk-cache.js";
import { createSecClient } from "../src/lib/ingest/fetch/sec.js";
import { ingestNport } from "../src/lib/services/index/ingest-nport.js";
import { incrementalSince } from "../src/lib/services/index/run-scheduled-ingest.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES = ["nport"] as const;

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
    const since = sinceArgument ?? (await incrementalSince(db, "nport"));
    console.log(`nport: filings ${since} to ${until}`);
    const report = await ingestNport(db, client, {
      since,
      until,
      ...(issuerSlugs === undefined ? {} : { issuerSlugs }),
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
