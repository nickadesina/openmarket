import { type Kysely, sql } from "kysely";

import { DEALER_PARAMS, type DealerParams, MODEL_VERSION } from "../../config/dealer.js";
import type {
  Database,
  InstrumentRow,
  InstrumentState,
  ListingRow,
  QuoteFlagState,
  QuoteInsert,
  QuoteReason,
  QuoteRow,
} from "../../db/schema.js";
import { type ForwardQuote, quote as forwardQuote } from "../../engine/dealer/forward.js";
import { RULEBOOK_VERSION } from "../../engine/dealer/rulebook.js";

/**
 * What every dealer operation shares about an instrument's book
 * (TECHNICAL_DESIGN.md §3, §6): which states trade, how a listing's
 * parameters become a forward quote, the forward's inventory, and the shape
 * of a `quotes` row. Reads only; each operation owns its writes.
 */

export const LIVE_STATES: readonly InstrumentState[] = ["quoting", "widened"];

/** `markets.bucket_grid_version` of a dealer binary's and forward's book. */
export const BINARY_BOOK_GRID_VERSION = "binary-v1";
export const FORWARD_BOOK_GRID_VERSION = "forward-v1";

/** The source a settlement cites when no flag decided it: a NO at expiry, or a void. */
export const RULEBOOK_SOURCE_URL = "/api/ref/rulebook";

export type ForwardQuoteListing = Pick<
  ListingRow,
  "tier" | "kappa" | "cap_cents" | "gamma" | "spread_floor"
>;

/** Whether a forward quotes widened at `at`: a flag holds it until widened_until. */
export function isWidened(
  instrument: Pick<InstrumentRow, "state" | "widened_until">,
  at: Date,
): boolean {
  return (
    instrument.state === "widened" &&
    instrument.widened_until !== null &&
    at < instrument.widened_until
  );
}

/** forward.ts's quote from a listing's versioned parameters and params.json's σ and flag rules. */
export function forwardQuoteFor(
  listing: ForwardQuoteListing,
  midLn: number,
  inventoryCents: number,
  flagState: QuoteFlagState,
  params: DealerParams = DEALER_PARAMS,
): ForwardQuote {
  return forwardQuote({
    midLn,
    inventoryCents,
    capCents: Number(listing.cap_cents),
    kappa: listing.kappa,
    gamma: listing.gamma,
    sFloor: listing.spread_floor,
    sigmaTier: params.sigma_tier[listing.tier],
    widened: flagState === "widened",
    flagSpreadMult: params.dealer.flag_spread_mult,
    flagCapMult: params.dealer.flag_cap_mult,
  });
}

export interface ForwardInventory {
  /** Open long notional, cents. */
  readonly longCents: number;
  /** Open short notional, cents. */
  readonly shortCents: number;
  /** Dealer inventory I = Σ short − Σ long notional, cents (forward.ts's sign). */
  readonly inventoryCents: number;
}

/** The forward's open positions, summed: neither settled nor voided. */
export async function openForwardInventory(
  db: Kysely<Database>,
  instrumentId: string,
): Promise<ForwardInventory> {
  const row = await db
    .selectFrom("forward_positions")
    .select([
      sql<string>`coalesce(sum(notional_cents) filter (where side = 'long'), 0)::text`.as("long"),
      sql<string>`coalesce(sum(notional_cents) filter (where side = 'short'), 0)::text`.as("short"),
    ])
    .where("instrument_id", "=", instrumentId)
    .where("settled_at", "is", null)
    .where("voided_at", "is", null)
    .executeTakeFirstOrThrow();
  const longCents = Number(row.long);
  const shortCents = Number(row.short);
  return { longCents, shortCents, inventoryCents: shortCents - longCents };
}

export interface LatestMid {
  readonly id: string;
  readonly computed_at: Date;
  readonly mid_ln: number | null;
  readonly p: number | null;
}

/** The instrument's latest model mid computed at or before `at`. */
export async function latestMid(
  db: Kysely<Database>,
  instrumentId: string,
  at: Date,
): Promise<LatestMid | undefined> {
  return db
    .selectFrom("model_mids")
    .select(["id", "computed_at", "mid_ln", "p"])
    .where("instrument_id", "=", instrumentId)
    .where("computed_at", "<=", at)
    .orderBy("computed_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
}

/** The instrument's latest posted quote. */
export async function latestQuote(
  db: Kysely<Database>,
  instrumentId: string,
): Promise<QuoteRow | undefined> {
  return db
    .selectFrom("quotes")
    .selectAll()
    .where("instrument_id", "=", instrumentId)
    .orderBy("posted_at", "desc")
    .orderBy("sequence", "desc")
    .executeTakeFirst();
}

interface QuoteRowBase {
  readonly instrumentId: string;
  readonly postedAt: Date;
  readonly reason: QuoteReason;
  readonly modelMidId: string | null;
  readonly tradeId?: string | null;
}

/** A forward's `quotes` row: mid, bid and ask in ln USD at inventory I. */
export function forwardQuoteRow(
  base: QuoteRowBase,
  quoted: ForwardQuote,
  flagState: QuoteFlagState,
): QuoteInsert {
  return {
    instrument_id: base.instrumentId,
    posted_at: base.postedAt,
    reason: base.reason,
    model_mid_id: base.modelMidId,
    mid_ln: quoted.mid,
    bid_ln: quoted.bid,
    ask_ln: quoted.ask,
    price: null,
    half_spread: quoted.halfSpread,
    inventory_cents: String(quoted.inventoryCents),
    cap_cents_effective: String(quoted.effectiveCapCents),
    flag_state: flagState,
    trade_id: base.tradeId ?? null,
    model_version: MODEL_VERSION,
    rulebook_version: RULEBOOK_VERSION,
  };
}

/**
 * A binary's `quotes` row: the LMSR YES price. A binary has no inventory or
 * cap in the forward's sense (its bound is b·ln(1/p_floor)), so both are 0.
 */
export function binaryQuoteRow(base: QuoteRowBase, yesPrice: number): QuoteInsert {
  return {
    instrument_id: base.instrumentId,
    posted_at: base.postedAt,
    reason: base.reason,
    model_mid_id: base.modelMidId,
    mid_ln: null,
    bid_ln: null,
    ask_ln: null,
    price: yesPrice,
    half_spread: null,
    inventory_cents: "0",
    cap_cents_effective: "0",
    flag_state: "normal",
    trade_id: base.tradeId ?? null,
    model_version: MODEL_VERSION,
    rulebook_version: RULEBOOK_VERSION,
  };
}

/** Whether a fresh quote row would repeat the latest one (time, reason and trade aside). */
export function sameQuote(previous: QuoteRow | undefined, next: QuoteInsert): boolean {
  return (
    previous !== undefined &&
    previous.model_mid_id === (next.model_mid_id ?? null) &&
    previous.mid_ln === (next.mid_ln ?? null) &&
    previous.bid_ln === (next.bid_ln ?? null) &&
    previous.ask_ln === (next.ask_ln ?? null) &&
    previous.price === (next.price ?? null) &&
    previous.half_spread === (next.half_spread ?? null) &&
    previous.inventory_cents === next.inventory_cents &&
    previous.cap_cents_effective === next.cap_cents_effective &&
    previous.flag_state === next.flag_state &&
    previous.model_version === next.model_version &&
    previous.rulebook_version === next.rulebook_version
  );
}
