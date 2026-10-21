import type { Kysely } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type {
  Database,
  InstrumentKind,
  JsonValue,
  QuoteFlagState,
  QuoteReason,
} from "../../db/schema.js";
import {
  afterPosition,
  cursorAfter,
  cursorTime,
  decodeCursor,
  type KeysetPosition,
  loadRefListing,
  type RefEnvelope,
  refEnvelope,
  signOf,
  takePage,
  usdOfLn,
} from "./ref-common.js";

/**
 * GET /api/ref/[slug]/history (TECHNICAL_DESIGN.md §8): the name's
 * `reference_prices` rows and its quote tape (every quote on its binary and
 * forward, all epochs), oldest first, between `from` and `to` inclusive.
 * Each stream pages on its own keyset; `next_cursor` carries both and is
 * null once both are exhausted.
 *
 * The tape publishes the sign of the dealer's inventory, not its size, as
 * the reference does (README D14).
 */

export const HISTORY_STREAMS = ["references", "quotes"] as const;

export interface RefHistoryQuery {
  readonly from?: Date;
  readonly to?: Date;
  readonly cursor?: string;
  readonly limit: number;
}

export interface RefHistoryReference {
  readonly id: string;
  readonly kind: InstrumentKind;
  readonly as_of: Date;
  /** ln USD for the forward, probability for the binary. */
  readonly value: number;
  readonly usd: number | null;
  readonly blend_version: string;
  readonly model_version: string;
  readonly rulebook_version: string;
  readonly weights: { readonly model: number; readonly traded: number; readonly crowd: number };
  readonly components: JsonValue;
}

export interface RefHistoryQuote {
  readonly sequence: string;
  readonly instrument_id: string;
  readonly kind: InstrumentKind;
  readonly epoch: number;
  readonly posted_at: Date;
  readonly reason: QuoteReason;
  readonly model_mid_id: string | null;
  readonly mid_ln: number | null;
  readonly mid_usd: number | null;
  readonly bid_ln: number | null;
  readonly bid_usd: number | null;
  readonly ask_ln: number | null;
  readonly ask_usd: number | null;
  readonly price: number | null;
  readonly half_spread: number | null;
  readonly dealer_inventory_sign: -1 | 0 | 1;
  readonly cap_usd_effective: number;
  readonly flag_state: QuoteFlagState;
  readonly model_version: string;
  readonly rulebook_version: string;
}

export interface RefHistoryPayload extends RefEnvelope {
  readonly slug: string;
  readonly from: Date | null;
  readonly to: Date;
  readonly references: readonly RefHistoryReference[];
  readonly quotes: readonly RefHistoryQuote[];
  readonly next_cursor: string | null;
}

function usdOrNull(ln: number | null): number | null {
  return ln === null ? null : usdOfLn(ln);
}

interface Window {
  readonly listingId: string;
  readonly from: Date | undefined;
  readonly to: Date;
  readonly limit: number;
}

async function referencePage(db: Kysely<Database>, window: Window, after: KeysetPosition | null) {
  let builder = db
    .selectFrom("reference_prices")
    .selectAll()
    .select(cursorTime("as_of").as("cursor_at"))
    .where("listing_id", "=", window.listingId)
    .where("as_of", "<=", window.to);
  if (window.from !== undefined) builder = builder.where("as_of", ">=", window.from);
  if (after !== null) builder = builder.where(afterPosition("as_of", "id", after, "uuid"));
  const rows = await builder
    .orderBy("as_of")
    .orderBy("id")
    .limit(window.limit + 1)
    .execute();
  return takePage(rows, window.limit, (row) => ({ at: row.cursor_at, key: row.id }));
}

async function quotePage(db: Kysely<Database>, window: Window, after: KeysetPosition | null) {
  let builder = db
    .selectFrom("quotes")
    .innerJoin("instruments", "instruments.id", "quotes.instrument_id")
    .selectAll("quotes")
    .select([
      "instruments.kind",
      "instruments.epoch",
      cursorTime("quotes.posted_at").as("cursor_at"),
    ])
    .where("instruments.listing_id", "=", window.listingId)
    .where("quotes.posted_at", "<=", window.to);
  if (window.from !== undefined) builder = builder.where("quotes.posted_at", ">=", window.from);
  if (after !== null) {
    builder = builder.where(afterPosition("quotes.posted_at", "quotes.sequence", after, "bigint"));
  }
  const rows = await builder
    .orderBy("quotes.posted_at")
    .orderBy("quotes.sequence")
    .limit(window.limit + 1)
    .execute();
  return takePage(rows, window.limit, (row) => ({ at: row.cursor_at, key: row.sequence }));
}

export async function getRefHistory(
  db: Kysely<Database>,
  slug: string,
  query: RefHistoryQuery,
  now: Date,
): Promise<RefHistoryPayload> {
  const to = query.to === undefined || query.to > now ? now : query.to;
  if (query.from !== undefined && query.from > to) {
    throw new ServiceError("INVALID_INPUT", "from must not be after to.", { parameter: "from" });
  }
  const listing = await loadRefListing(db, slug);
  const cursor = decodeCursor(query.cursor, HISTORY_STREAMS);
  const window: Window = { listingId: listing.id, from: query.from, to, limit: query.limit };
  const references =
    cursor.references === "end"
      ? { items: [], next: "end" as const }
      : await referencePage(db, window, cursor.references);
  const quotes =
    cursor.quotes === "end"
      ? { items: [], next: "end" as const }
      : await quotePage(db, window, cursor.quotes);

  return {
    ...refEnvelope(now),
    slug: listing.company.slug,
    from: query.from ?? null,
    to,
    references: references.items.map((row) => ({
      id: row.id,
      kind: row.kind,
      as_of: row.as_of,
      value: row.value,
      usd: row.kind === "forward" ? usdOfLn(row.value) : null,
      blend_version: row.blend_version,
      model_version: row.model_version,
      rulebook_version: row.rulebook_version,
      weights: { model: row.w_model, traded: row.w_traded, crowd: row.w_crowd },
      components: row.components_json,
    })),
    quotes: quotes.items.map((row) => ({
      sequence: row.sequence,
      instrument_id: row.instrument_id,
      kind: row.kind,
      epoch: row.epoch,
      posted_at: row.posted_at,
      reason: row.reason,
      model_mid_id: row.model_mid_id,
      mid_ln: row.mid_ln,
      mid_usd: usdOrNull(row.mid_ln),
      bid_ln: row.bid_ln,
      bid_usd: usdOrNull(row.bid_ln),
      ask_ln: row.ask_ln,
      ask_usd: usdOrNull(row.ask_ln),
      price: row.price,
      half_spread: row.half_spread,
      dealer_inventory_sign: signOf(Number(row.inventory_cents)),
      cap_usd_effective: Number(row.cap_cents_effective) / 100,
      flag_state: row.flag_state,
      model_version: row.model_version,
      rulebook_version: row.rulebook_version,
    })),
    next_cursor: cursorAfter({ references: references.next, quotes: quotes.next }),
  };
}
