/**
 * Imports the round-history dataset's prints for watchlist issuers into
 * `prints`, then links any imported certificate to the round it prices:
 * `npm run index:prints`. Idempotent. Run `npm run index:watchlist` first.
 * Uses DATABASE_URL_UNPOOLED.
 */
import { readFileSync } from "node:fs";

import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { linkCertificatePrints } from "../src/lib/services/index/import-certificates.js";
import { importPrints, printCandidates } from "../src/lib/services/index/import-prints.js";
import { EVENTS_CSV_PATH, SOURCES_CSV_PATH } from "../src/lib/tradeables/round-history.js";

async function main(): Promise<void> {
  const db = createDirectDatabase();
  try {
    const issuers = await db
      .selectFrom("issuers")
      .select(["slug", "name"])
      .where("watchlisted", "=", true)
      .execute();
    const { candidates, unmatchedCompanies } = printCandidates(
      readFileSync(EVENTS_CSV_PATH, "utf8"),
      readFileSync(SOURCES_CSV_PATH, "utf8"),
      issuers,
    );
    const report = await importPrints(db, candidates, unmatchedCompanies);
    console.log(
      `prints: ${candidates.length} in the dataset for watchlist issuers, ${report.inserted} new, ${report.unchanged} unchanged`,
    );
    for (const row of report.differing) {
      console.warn(
        `differs from the stored print (a correction, not an update): ${row.issuer} ${row.roundName}`,
      );
    }
    if (unmatchedCompanies.length > 0) {
      console.log(`not on the watchlist: ${unmatchedCompanies.join(", ")}`);
    }
    for (const link of await linkCertificatePrints(db)) {
      console.log(
        `certificate ${link.issuer} ${link.certificateFiledOn}: ${link.reason} ${link.roundName ?? ""}`,
      );
    }
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error("index:prints failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
