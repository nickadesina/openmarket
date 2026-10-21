/**
 * Lists the five launch names (README D10) from backtest/events.csv,
 * backtest/data/sources.csv and backtest/out/params.json:
 *
 *   npm run seed:listings -- --listed-at=2026-10-22T00:00:00Z
 *   npm run seed:listings -- --listed-at=… --relist   # replace active listings
 *
 * Idempotent on (company, listed_at). Refuses, writing nothing, when any
 * anchor has no source URL. Instruments are listed by the dealer job.
 */
import { existsSync, readFileSync } from "node:fs";

import { isServiceError } from "../src/lib/api/errors.js";
import { DEALER_PARAMS } from "../src/lib/config/dealer.js";
import {
  EVENTS_CSV_PATH,
  listingAnchors,
  SOURCES_CSV_PATH,
} from "../src/lib/config/listing-anchors.js";
import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { seedListings } from "../src/lib/services/dealer/seed-listings.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const listedAtArgument = argument("listed-at");
  if (listedAtArgument === undefined || !/^\d{4}-\d{2}-\d{2}T/.test(listedAtArgument)) {
    throw new Error("--listed-at=<ISO timestamp> is required");
  }
  const listedAt = new Date(listedAtArgument);
  if (Number.isNaN(listedAt.getTime())) throw new Error("--listed-at must be an ISO timestamp");

  const sourcesCsv = existsSync(SOURCES_CSV_PATH) ? readFileSync(SOURCES_CSV_PATH, "utf8") : null;
  if (sourcesCsv === null) console.error(`${SOURCES_CSV_PATH} not found`);
  const anchors = listingAnchors(
    readFileSync(EVENTS_CSV_PATH, "utf8"),
    sourcesCsv,
    Object.keys(DEALER_PARAMS.forward_t_days),
  );

  const db = createDirectDatabase();
  try {
    const results = await seedListings(db, {
      listedAt,
      relist: process.argv.includes("--relist"),
      anchors,
    });
    for (const { company, listing, outcome, delisted } of results) {
      const closed = delisted === null ? "" : `; delisted ${delisted.id}`;
      console.log(
        `Listing ${outcome}: ${company.slug} ${listing.tier} ${listing.binary_event} ` +
          `T=${listing.forward_t_days}d anchor ${listing.anchor_round} ${listing.anchor_date}${closed}`,
      );
    }
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch (error: unknown) {
  if (isServiceError(error)) {
    console.error(`Listing seed refused: ${error.message}`);
  } else {
    console.error("Listing seed failed:", error instanceof Error ? error.message : "");
  }
  process.exitCode = 1;
}
