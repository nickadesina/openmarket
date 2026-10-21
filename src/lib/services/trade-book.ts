import type { Transaction } from "kysely";

import { ServiceError } from "../api/errors.js";
import type { Database, InstrumentRow, MarketRow } from "../db/schema.js";
import { assertLive } from "./dealer/get-instrument-quote.js";

/**
 * The book an LMSR quote or trade addresses: a dealer binary by `market_id`,
 * or a company's ladder market (no instrument) by `slug`. A dealer book also
 * brings its instrument, so the caller can refuse a closed one and clamp the
 * price to [p_floor, 1 − p_floor].
 */

export interface BookReference {
  readonly slug?: string | undefined;
  readonly market_id?: string | undefined;
}

export interface TradeBook {
  readonly market: MarketRow;
  /** Set when the book is a dealer instrument's. */
  readonly dealer: { readonly instrument: InstrumentRow; readonly pFloor: number } | null;
}

async function bySlug(db: Transaction<Database>, slug: string, lock: boolean): Promise<MarketRow> {
  let query = db
    .selectFrom("markets")
    .innerJoin("companies", "companies.id", "markets.company_id")
    .selectAll("markets")
    .where("companies.slug", "=", slug)
    .where("markets.status", "=", "open")
    .where("markets.instrument_id", "is", null)
    .orderBy("markets.created_at", "desc");
  if (lock) query = query.forUpdate("markets");
  const market = await query.executeTakeFirst();
  if (market !== undefined) return market;
  const latest = await db
    .selectFrom("markets")
    .innerJoin("companies", "companies.id", "markets.company_id")
    .select("markets.status")
    .where("companies.slug", "=", slug)
    .where("markets.instrument_id", "is", null)
    .orderBy("markets.created_at", "desc")
    .executeTakeFirst();
  if (latest?.status === "settled") {
    throw new ServiceError("MARKET_SETTLED", "Market is settled.");
  }
  throw new ServiceError("MARKET_NOT_FOUND", "Open market not found.");
}

/**
 * A dealer book by id. With `lock`, the instrument is locked before the book,
 * the order the settle job takes them in.
 */
async function byId(
  db: Transaction<Database>,
  marketId: string,
  lock: boolean,
): Promise<TradeBook> {
  const found = await db
    .selectFrom("markets")
    .select(["instrument_id"])
    .where("id", "=", marketId)
    .executeTakeFirst();
  if (found === undefined) throw new ServiceError("MARKET_NOT_FOUND", "Market not found.");
  let instrument: InstrumentRow | undefined;
  if (found.instrument_id !== null) {
    let query = db.selectFrom("instruments").selectAll().where("id", "=", found.instrument_id);
    if (lock) query = query.forUpdate();
    instrument = await query.executeTakeFirstOrThrow();
  }
  let marketQuery = db.selectFrom("markets").selectAll().where("id", "=", marketId);
  if (lock) marketQuery = marketQuery.forUpdate();
  const market = await marketQuery.executeTakeFirstOrThrow();
  if (market.metric_kind === "forward_ln") {
    throw new ServiceError("INVALID_INPUT", "A forward trades through POST /api/forward/trade.");
  }
  if (market.status === "settled") throw new ServiceError("MARKET_SETTLED", "Market is settled.");
  if (instrument === undefined) return { market, dealer: null };
  const listing = await db
    .selectFrom("listings")
    .select("p_floor")
    .where("id", "=", instrument.listing_id)
    .executeTakeFirstOrThrow();
  return { market, dealer: { instrument, pFloor: listing.p_floor } };
}

/** The open book `reference` names; check a dealer's with assertBookLive once the clock is read. */
export async function findTradeBook(
  db: Transaction<Database>,
  reference: BookReference,
  lock: boolean,
): Promise<TradeBook> {
  return reference.market_id !== undefined
    ? byId(db, reference.market_id, lock)
    : { market: await bySlug(db, reference.slug!, lock), dealer: null };
}

/** Refuses a dealer book whose instrument is not live at `at`. */
export function assertBookLive(book: TradeBook, at: Date): void {
  if (book.dealer !== null) {
    assertLive({ instrument: book.dealer.instrument, market: book.market }, at);
  }
}
