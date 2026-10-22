import type { Kysely, Transaction } from "kysely";

import { ServiceError } from "../../api/errors.js";
import { parseUsdToCents } from "../../api/money.js";
import type { ForwardQuoteQuery } from "../../api/schemas.js";
import { MODEL_VERSION } from "../../config/dealer.js";
import type {
  CompanyRow,
  Database,
  ForwardSide,
  InstrumentKind,
  InstrumentRow,
  InstrumentState,
  ListingRow,
  MarketRow,
  QuoteFlagState,
} from "../../db/schema.js";
import {
  collateralCents,
  type ForwardQuote,
  fill,
  maxFillCents,
} from "../../engine/dealer/forward.js";
import { RULEBOOK_VERSION } from "../../engine/dealer/rulebook.js";
import { assertMayTrade, type Trader } from "../tournament/restrictions.js";
import {
  forwardQuoteFor,
  isWidened,
  type LatestMid,
  LIVE_STATES,
  latestMid,
  openForwardInventory,
} from "./dealer-books.js";

/**
 * The live quote of one instrument (TECHNICAL_DESIGN.md §6): for a forward,
 * forward.ts's two-way quote from the latest mid, the open inventory and the
 * flag state, with an optional fill preview; for a binary, the LMSR YES
 * price. Computed at the moment of asking, never read off the tape, so it is
 * what /api/forward/trade would fill against now.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface InstrumentBook {
  readonly instrument: InstrumentRow;
  readonly listing: ListingRow;
  readonly company: Pick<CompanyRow, "id" | "name" | "slug">;
  readonly market: MarketRow;
}

export interface ForwardBookState extends InstrumentBook {
  readonly mid: LatestMid & { readonly mid_ln: number };
  readonly flagState: QuoteFlagState;
  readonly quote: ForwardQuote;
}

export function parseInstrumentId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new ServiceError("INVALID_INPUT", "Invalid instrument id.", {
      parameter: "instrumentId",
    });
  }
  return value.toLowerCase();
}

/** The instrument, its listing, company and book; `lock` takes instrument then book for update. */
export async function loadInstrumentBook(
  db: Kysely<Database>,
  instrumentId: string,
  lock = false,
): Promise<InstrumentBook> {
  let instrumentQuery = db.selectFrom("instruments").selectAll().where("id", "=", instrumentId);
  if (lock) instrumentQuery = instrumentQuery.forUpdate();
  const instrument = await instrumentQuery.executeTakeFirst();
  if (instrument === undefined) {
    throw new ServiceError("MARKET_NOT_FOUND", "Instrument not found.");
  }
  let marketQuery = db.selectFrom("markets").selectAll().where("instrument_id", "=", instrumentId);
  if (lock) marketQuery = marketQuery.forUpdate();
  const market = await marketQuery.executeTakeFirstOrThrow();
  const listing = await db
    .selectFrom("listings")
    .selectAll()
    .where("id", "=", instrument.listing_id)
    .executeTakeFirstOrThrow();
  const company = await db
    .selectFrom("companies")
    .select(["id", "name", "slug"])
    .where("id", "=", listing.company_id)
    .executeTakeFirstOrThrow();
  return { instrument, listing, company, market };
}

/** Refuses an instrument that is not live at `at`: resolved, expired, past T, or its book settled. */
export function assertLive(
  book: {
    readonly instrument: Pick<InstrumentRow, "id" | "state" | "opens_at" | "expires_at">;
    readonly market: Pick<MarketRow, "status">;
  },
  at: Date,
): void {
  const { instrument, market } = book;
  if (
    !LIVE_STATES.includes(instrument.state) ||
    market.status !== "open" ||
    at > instrument.expires_at ||
    at < instrument.opens_at
  ) {
    throw new ServiceError("INSTRUMENT_CLOSED", "This instrument is not trading.", {
      instrument_id: instrument.id,
      state: instrument.state,
      expires_at: instrument.expires_at.toISOString(),
    });
  }
}

/** A live forward's quote at `at`, from its latest mid, open inventory and flag state. */
export async function loadForwardBook(
  db: Kysely<Database>,
  book: InstrumentBook,
  at: Date,
): Promise<ForwardBookState> {
  if (book.instrument.kind !== "forward") {
    throw new ServiceError("INVALID_INPUT", "This instrument is not a forward.");
  }
  assertLive(book, at);
  const mid = await latestMid(db, book.instrument.id, at);
  if (mid === undefined || mid.mid_ln === null) {
    throw new ServiceError("INSTRUMENT_CLOSED", "This forward has no model mid yet.");
  }
  const flagState: QuoteFlagState = isWidened(book.instrument, at) ? "widened" : "normal";
  const { inventoryCents } = await openForwardInventory(db, book.instrument.id);
  const quote = forwardQuoteFor(book.listing, mid.mid_ln, inventoryCents, flagState);
  return { ...book, mid: { ...mid, mid_ln: mid.mid_ln }, flagState, quote };
}

export interface ForwardFillPreview {
  readonly side: ForwardSide;
  readonly notional_cents: string;
  /** Whether /api/forward/trade would fill it now; false when the cap refuses it. */
  readonly allowed: boolean;
  readonly refusal: "side_pulled" | "exceeds_cap" | null;
  /** Most notional this side takes now, cents. */
  readonly max_notional_cents: string;
  /** F₀: the ask for a long, the bid for a short, ln USD. */
  readonly entry_ln: number;
  readonly entry_usd: number;
  /** N·κ, rounded up: debited at open; also the most the position can lose or gain. */
  readonly collateral_cents: string;
  readonly max_loss_cents: string;
  readonly max_gain_cents: string;
}

interface InstrumentQuoteBase {
  readonly instrument_id: string;
  readonly market_id: string;
  readonly kind: InstrumentKind;
  readonly company: { readonly name: string; readonly slug: string };
  readonly question: string;
  readonly epoch: number;
  readonly state: InstrumentState;
  readonly opens_at: string;
  readonly expires_at: string;
  readonly model_mid_id: string;
  readonly model_version: string;
  readonly rulebook_version: string;
  readonly quoted_at: string;
}

export interface ForwardInstrumentQuote extends InstrumentQuoteBase {
  readonly kind: "forward";
  readonly mid_ln: number;
  readonly mid_usd: number;
  /** Shown even when pulled; max_*_notional_cents of 0 means that side does not fill. */
  readonly bid_ln: number;
  readonly ask_ln: number;
  readonly bid_usd: number;
  readonly ask_usd: number;
  readonly half_spread: number;
  readonly kappa: number;
  /** Dealer inventory I = Σ short − Σ long open notional, cents; its sign is the dealer's. */
  readonly inventory_cents: string;
  readonly cap_cents: string;
  readonly effective_cap_cents: string;
  readonly max_long_notional_cents: string;
  readonly max_short_notional_cents: string;
  readonly flag_state: QuoteFlagState;
  readonly widened_until: string | null;
  readonly fill: ForwardFillPreview | null;
}

export interface BinaryInstrumentQuote extends InstrumentQuoteBase {
  readonly kind: "binary";
  /** P(YES) on the LMSR book: the price of a YES share paying $1. */
  readonly yes_price: number;
  readonly no_price: number;
  /** The model's seed p for this quarter. */
  readonly model_p: number;
  readonly p_floor: number;
  readonly b_usd: number;
}

export type InstrumentQuote = ForwardInstrumentQuote | BinaryInstrumentQuote;

function baseOf(book: InstrumentBook, modelMidId: string, at: Date): InstrumentQuoteBase {
  return {
    instrument_id: book.instrument.id,
    market_id: book.market.id,
    kind: book.instrument.kind,
    company: { name: book.company.name, slug: book.company.slug },
    question: book.instrument.question,
    epoch: book.instrument.epoch,
    state: book.instrument.state,
    opens_at: book.instrument.opens_at.toISOString(),
    expires_at: book.instrument.expires_at.toISOString(),
    model_mid_id: modelMidId,
    model_version: MODEL_VERSION,
    rulebook_version: RULEBOOK_VERSION,
    quoted_at: at.toISOString(),
  };
}

export function fillPreview(
  quote: ForwardQuote,
  kappa: number,
  side: ForwardSide,
  notionalCents: number,
): ForwardFillPreview {
  const filled = fill(side, notionalCents, quote);
  const entryLn = side === "long" ? quote.ask : quote.bid;
  const collateral = String(collateralCents(notionalCents, kappa));
  return {
    side,
    notional_cents: String(notionalCents),
    allowed: filled.ok,
    refusal: filled.ok || filled.reason === "non_positive" ? null : filled.reason,
    max_notional_cents: String(maxFillCents(side, quote)),
    entry_ln: entryLn,
    entry_usd: Math.exp(entryLn),
    collateral_cents: collateral,
    max_loss_cents: collateral,
    max_gain_cents: collateral,
  };
}

export function forwardQuoteView(
  state: ForwardBookState,
  at: Date,
  preview: ForwardFillPreview | null,
): ForwardInstrumentQuote {
  const { quote, instrument } = state;
  return {
    ...baseOf(state, state.mid.id, at),
    kind: "forward",
    mid_ln: quote.mid,
    mid_usd: Math.exp(quote.mid),
    bid_ln: quote.bid,
    ask_ln: quote.ask,
    bid_usd: Math.exp(quote.bid),
    ask_usd: Math.exp(quote.ask),
    half_spread: quote.halfSpread,
    kappa: state.listing.kappa,
    inventory_cents: String(quote.inventoryCents),
    cap_cents: state.listing.cap_cents,
    effective_cap_cents: String(quote.effectiveCapCents),
    max_long_notional_cents: String(quote.maxLongCents),
    max_short_notional_cents: String(quote.maxShortCents),
    flag_state: state.flagState,
    widened_until:
      state.flagState === "widened" ? (instrument.widened_until?.toISOString() ?? null) : null,
    fill: preview,
  };
}

async function binaryQuote(
  db: Kysely<Database>,
  book: InstrumentBook,
  at: Date,
): Promise<BinaryInstrumentQuote> {
  assertLive(book, at);
  const mid = await latestMid(db, book.instrument.id, at);
  if (mid === undefined || mid.p === null) {
    throw new ServiceError("INSTRUMENT_CLOSED", "This binary has no model price yet.");
  }
  const yes = book.market.current_metric;
  return {
    ...baseOf(book, mid.id, at),
    kind: "binary",
    yes_price: yes,
    no_price: 1 - yes,
    model_p: mid.p,
    p_floor: book.listing.p_floor,
    b_usd: book.market.b,
  };
}

/** A live instrument's quote without a fill preview; INSTRUMENT_CLOSED when it is not live. */
export async function quoteBook(
  db: Kysely<Database>,
  book: InstrumentBook,
  at: Date,
): Promise<InstrumentQuote> {
  if (book.instrument.kind === "binary") return binaryQuote(db, book, at);
  return forwardQuoteView(await loadForwardBook(db, book, at), at, null);
}

/**
 * `GET /api/instruments/[instrumentId]/quote`. A forward with `side` and
 * `notional_usd` also previews that fill; a binary takes neither (its trade
 * preview is POST /api/quote with its market_id).
 */
export async function getInstrumentQuote(
  db: Kysely<Database>,
  instrumentId: string,
  query: ForwardQuoteQuery,
  at: Date = new Date(),
  viewer: Trader | null = null,
): Promise<InstrumentQuote> {
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (transaction: Transaction<Database>) => {
      const book = await loadInstrumentBook(transaction, instrumentId);
      // Anonymous quotes are public; a signed-in restricted person is refused (README D12).
      if (viewer !== null) await assertMayTrade(transaction, viewer, book.listing.company_id);
      if (book.instrument.kind === "binary") {
        if (query.side !== undefined) {
          throw new ServiceError(
            "INVALID_INPUT",
            "A binary previews trades through POST /api/quote with its market_id.",
          );
        }
        return binaryQuote(transaction, book, at);
      }
      const state = await loadForwardBook(transaction, book, at);
      const preview =
        query.side === undefined || query.notional_usd === undefined
          ? null
          : fillPreview(
              state.quote,
              state.listing.kappa,
              query.side,
              parseUsdToCents(query.notional_usd),
            );
      return forwardQuoteView(state, at, preview);
    });
}
