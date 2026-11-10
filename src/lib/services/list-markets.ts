import type { Kysely } from "kysely";

import { ServiceError } from "../api/errors.js";
import { archiveNow } from "../config/archive.js";
import { MODEL_VERSION } from "../config/dealer.js";
import type { Database } from "../db/schema.js";
import { RULEBOOK_VERSION } from "../engine/dealer/rulebook.js";
import { type ListingView, loadListings, readListings } from "./get-market.js";

/**
 * `GET /api/markets`: every active listing (README D10), each read as
 * `getMarket` reads it, ordered by open interest and then name.
 */

export interface MarketListOptions {
  readonly now?: Date;
}

export interface MarketListResult {
  readonly listings: ListingView[];
  readonly modelVersion: string;
  readonly rulebookVersion: string;
  readonly asOf: string;
}

export async function listMarkets(
  db: Kysely<Database>,
  options: MarketListOptions = {},
): Promise<MarketListResult> {
  const at = options.now === undefined ? archiveNow() : new Date(options.now.getTime());
  if (!Number.isFinite(at.getTime())) {
    throw new ServiceError("INVALID_INPUT", "Read clock must be a valid date.");
  }
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (transaction) => {
      const listings = await readListings(
        transaction,
        await loadListings(transaction, { active: at }),
        at,
      );
      listings.sort(
        (left, right) =>
          right.openInterest.totalUsd - left.openInterest.totalUsd ||
          left.company.name.localeCompare(right.company.name),
      );
      return {
        listings,
        modelVersion: MODEL_VERSION,
        rulebookVersion: RULEBOOK_VERSION,
        asOf: at.toISOString(),
      };
    });
}
