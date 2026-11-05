/**
 * Syncs data/index/watchlist.json into `issuers`:
 *
 *   npm run index:watchlist
 *
 * Validates the file (zod) and inserts or updates one row per name and
 * candidate. Uses DATABASE_URL_UNPOOLED.
 */
import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { loadWatchlist } from "../src/lib/services/index/data-files.js";
import { syncWatchlist } from "../src/lib/services/index/sync-watchlist.js";

async function main(): Promise<void> {
  const watchlist = loadWatchlist();
  const db = createDirectDatabase();
  try {
    const report = await syncWatchlist(db, watchlist);
    console.log(
      `watchlist ${watchlist.version}: ${report.inserted.length} inserted, ${report.updated.length} updated, ${report.unwatchlisted.length} unwatchlisted`,
    );
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error("index:watchlist failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
