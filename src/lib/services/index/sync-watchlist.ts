/**
 * `npm run index:watchlist`: data/index/watchlist.json → `issuers`. The file
 * is the source of truth for each issuer's name, phrases, pattern and
 * whether it is watchlisted; a slug in the table but no longer in the file is
 * left in place (its marks keep their issuer) and unwatchlisted.
 */
import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import type { Watchlist } from "../../ingest/parse/watchlist.js";

export interface WatchlistSyncReport {
  readonly inserted: readonly string[];
  readonly updated: readonly string[];
  readonly unwatchlisted: readonly string[];
}

export async function syncWatchlist(
  db: Kysely<Database>,
  watchlist: Watchlist,
): Promise<WatchlistSyncReport> {
  return db.transaction().execute(async (trx) => {
    const existing = new Map(
      (await trx.selectFrom("issuers").selectAll().execute()).map((row) => [row.slug, row]),
    );
    const inserted: string[] = [];
    const updated: string[] = [];
    for (const issuer of watchlist.issuers) {
      const values = {
        name: issuer.name,
        legal_name: issuer.legalName,
        search_phrases: JSON.stringify(issuer.searchPhrases),
        match_pattern: issuer.matchPattern,
        watchlisted: issuer.watchlisted,
        listed_on: issuer.listing?.listedOn ?? null,
        listing_url: issuer.listing?.url ?? null,
      };
      const row = existing.get(issuer.slug);
      if (row === undefined) {
        await trx
          .insertInto("issuers")
          .values({ slug: issuer.slug, ...values })
          .execute();
        inserted.push(issuer.slug);
      } else if (
        row.name !== values.name ||
        row.legal_name !== values.legal_name ||
        JSON.stringify(row.search_phrases) !== values.search_phrases ||
        row.match_pattern !== values.match_pattern ||
        row.watchlisted !== values.watchlisted ||
        row.listed_on !== values.listed_on ||
        row.listing_url !== values.listing_url
      ) {
        await trx.updateTable("issuers").set(values).where("id", "=", row.id).execute();
        updated.push(issuer.slug);
      }
    }
    const listed = new Set(watchlist.issuers.map((issuer) => issuer.slug));
    const unwatchlisted = [...existing.values()]
      .filter((row) => !listed.has(row.slug) && row.watchlisted)
      .map((row) => row.slug);
    if (unwatchlisted.length > 0) {
      await trx
        .updateTable("issuers")
        .set({ watchlisted: false })
        .where("slug", "in", unwatchlisted)
        .execute();
    }
    return { inserted, updated, unwatchlisted };
  });
}
