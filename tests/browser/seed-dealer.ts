import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { seedDemo } from "../../scripts/seed-demo.js";
import { DEALER_PARAMS } from "../../src/lib/config/dealer.js";
import {
  EVENTS_CSV_PATH,
  listingAnchors,
  SOURCES_CSV_PATH,
} from "../../src/lib/config/listing-anchors.js";
import { createDirectDatabase, destroyDatabase } from "../../src/lib/db/client.js";
import { migrateToLatest } from "../../src/lib/db/migrator.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { seedListings } from "../../src/lib/services/dealer/seed-listings.js";

/**
 * Run by global-setup.ts under tsx (Playwright's own loader cannot import
 * params.json), against DATABASE_URL_TEST, never a production route: migrate, list the five names from the committed anchors (the
 * `seed:listings` service, at a fixed listing time so reruns are
 * unchanged), and run one dealer job so each name has a live binary and
 * forward with a mid and a quote, then seed the demo accounts' trades.
 */
const LISTED_AT = new Date("2026-10-21T00:00:00.000Z");

async function seedDealer(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST;
  if (url === undefined || url.trim() === "") return;
  const db = createDirectDatabase(url);
  try {
    const migration = await migrateToLatest(db);
    if (migration.error !== undefined) throw migration.error;
    const anchors = listingAnchors(
      readFileSync(EVENTS_CSV_PATH, "utf8"),
      readFileSync(SOURCES_CSV_PATH, "utf8"),
      Object.keys(DEALER_PARAMS.forward_t_days),
    );
    await seedListings(db, { listedAt: LISTED_AT, relist: false, anchors });
    // A failed run rethrows; a fresh run id never reports "already ran".
    await runDealerJob(db, `playwright-${randomUUID()}`);
    // The demo accounts trade once, as a deploy seeds them (decision 0005); a rerun does nothing.
    await seedDemo(db);
  } finally {
    await destroyDatabase(db);
  }
}

await seedDealer();
