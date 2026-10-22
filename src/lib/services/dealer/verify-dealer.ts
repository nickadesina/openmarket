import type { Kysely } from "kysely";
import { PARAMS_SHA256_BY_MODEL_VERSION } from "../../config/dealer.js";
import type { Database, ForwardSide, QuoteRow } from "../../db/schema.js";
import { type MidInputs, midFromInputs } from "./compute-mids.js";
import { type ForwardQuoteListing, forwardQuoteFor } from "./dealer-books.js";
import { verifyReferencePrices } from "./reference-prices.js";
import { groupBy } from "./service-helpers.js";
import { verifyLinkedQuestions } from "./tournament-bridge.js";

/** A stored mid must recompute from its inputs this closely. */
const MID_TOLERANCE = 1e-12;
/** A stored quote must recompute from its inputs this closely, in log units or probability. */
const QUOTE_TOLERANCE = 1e-12;

export interface DealerFinding {
  readonly id: string;
  readonly check:
    | "mid_recompute"
    | "quote_recompute"
    | "fill_entry"
    | "reference_recompute"
    | "linked_question";
  readonly detail: string;
}

export interface DealerVerification {
  readonly midsChecked: number;
  readonly quotesChecked: number;
  readonly referencesChecked: number;
  readonly linksChecked: number;
  readonly findings: DealerFinding[];
  readonly passed: boolean;
}

function isMidInputs(value: unknown): value is MidInputs {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "binary" || record.kind === "forward") &&
    typeof record.anchor === "object" &&
    record.anchor !== null
  );
}

function close(left: number | null, right: number): boolean {
  return left !== null && Math.abs(left - right) <= QUOTE_TOLERANCE;
}

async function verifyMids(db: Kysely<Database>, findings: DealerFinding[]): Promise<number> {
  const rows = await db
    .selectFrom("model_mids")
    .innerJoin("instruments", "instruments.id", "model_mids.instrument_id")
    .select([
      "model_mids.id",
      "model_mids.model_version",
      "model_mids.mid_ln",
      "model_mids.p",
      "model_mids.inputs_json",
      "instruments.kind",
    ])
    .orderBy("model_mids.computed_at")
    .orderBy("model_mids.id")
    .execute();

  const fail = (id: string, detail: string) =>
    findings.push({ id, check: "mid_recompute", detail });
  for (const row of rows) {
    if (PARAMS_SHA256_BY_MODEL_VERSION[row.model_version] === undefined) {
      fail(row.id, `model_version ${row.model_version} was never published`);
      continue;
    }
    const inputs = row.inputs_json;
    if (!isMidInputs(inputs) || inputs.kind !== row.kind) {
      fail(row.id, `inputs_json does not describe a ${row.kind} mid`);
      continue;
    }
    const stored = row.kind === "forward" ? row.mid_ln : row.p;
    if (stored === null) {
      fail(row.id, `a ${row.kind} mid with no ${row.kind === "forward" ? "mid_ln" : "p"}`);
      continue;
    }
    let recomputed: number;
    try {
      recomputed = midFromInputs(inputs);
    } catch (error) {
      fail(row.id, error instanceof Error ? error.message : "inputs do not recompute");
      continue;
    }
    if (!(Math.abs(recomputed - stored) <= MID_TOLERANCE)) {
      fail(row.id, `stored ${stored}, recomputed ${recomputed}`);
    }
  }
  return rows.length;
}

interface QuoteContext {
  readonly quote: QuoteRow;
  readonly listing: ForwardQuoteListing;
  readonly midLn: number | null;
}

interface PositionRow {
  readonly instrument_id: string;
  readonly trade_id: string;
  readonly side: ForwardSide;
  readonly notional_cents: string;
  readonly entry_ln: number;
  readonly opened_at: Date;
  readonly market_sequence: string;
}

/** I = Σ short − Σ long over the positions open when the quote was posted (before a fill's own). */
function inventoryAt(context: QuoteContext, positions: readonly PositionRow[]): number {
  const own = positions.find((position) => position.trade_id === context.quote.trade_id);
  let inventory = 0;
  for (const position of positions) {
    const before =
      own === undefined
        ? position.opened_at <= context.quote.posted_at
        : BigInt(position.market_sequence) < BigInt(own.market_sequence);
    if (!before) continue;
    const notional = Number(position.notional_cents);
    inventory += position.side === "short" ? notional : -notional;
  }
  return inventory;
}

/** A forward quote: its mid is its model mid's, and bid, ask, s and Q_eff recompute from I. */
function checkForwardQuote(
  context: QuoteContext,
  positions: readonly PositionRow[],
  fail: (check: DealerFinding["check"], detail: string) => void,
): void {
  const { quote } = context;
  if (context.midLn === null || quote.mid_ln !== context.midLn) {
    fail("quote_recompute", `mid_ln ${quote.mid_ln} is not its model mid's ${context.midLn}`);
    return;
  }
  const inventory = inventoryAt(context, positions);
  if (Number(quote.inventory_cents) !== inventory) {
    fail("quote_recompute", `inventory ${quote.inventory_cents}; open positions give ${inventory}`);
    return;
  }
  const recomputed = forwardQuoteFor(context.listing, quote.mid_ln, inventory, quote.flag_state);
  if (
    !close(quote.bid_ln, recomputed.bid) ||
    !close(quote.ask_ln, recomputed.ask) ||
    !close(quote.half_spread, recomputed.halfSpread) ||
    quote.cap_cents_effective !== String(recomputed.effectiveCapCents)
  ) {
    fail(
      "quote_recompute",
      `bid/ask/s/Q_eff do not recompute from mid ${quote.mid_ln}, I ${inventory}`,
    );
  }
  if (quote.reason !== "fill") return;
  const position = positions.find((row) => row.trade_id === quote.trade_id);
  const side = position?.side === "long" ? quote.ask_ln : quote.bid_ln;
  if (position === undefined || position.entry_ln !== side) {
    fail(
      "fill_entry",
      `fill entry ${position?.entry_ln} is not the quote's ${position?.side} side`,
    );
  }
}

/**
 * The dealer's half of verify:replay: every `model_mids` row recomputes
 * from its own inputs_json through prior.ts, and every `quotes` row from its
 * inputs: a forward's bid, ask and spread from its model mid, the open
 * inventory and its flag state through forward.ts; a binary's price from its
 * model p (list), the trade it filled (fill) or the book's mark (requote). A
 * fill's position entered at the side of the quote it filled. Every
 * `reference_prices` row recomputes from its components (reference-prices.ts).
 */
export async function verifyDealer(db: Kysely<Database>): Promise<DealerVerification> {
  const findings: DealerFinding[] = [];
  const midsChecked = await verifyMids(db, findings);

  const quotes = await db
    .selectFrom("quotes")
    .innerJoin("instruments", "instruments.id", "quotes.instrument_id")
    .innerJoin("listings", "listings.id", "instruments.listing_id")
    .innerJoin("markets", "markets.instrument_id", "instruments.id")
    .leftJoin("model_mids", "model_mids.id", "quotes.model_mid_id")
    .selectAll("quotes")
    .select([
      "instruments.kind",
      "listings.tier",
      "listings.kappa",
      "listings.cap_cents",
      "listings.gamma",
      "listings.spread_floor",
      "markets.id as market_id",
      "model_mids.mid_ln as model_mid_ln",
      "model_mids.p as model_p",
    ])
    .orderBy("quotes.posted_at")
    .orderBy("quotes.sequence")
    .execute();
  const positions = await db
    .selectFrom("forward_positions")
    .innerJoin("trades", "trades.id", "forward_positions.trade_id")
    .select([
      "forward_positions.instrument_id",
      "forward_positions.trade_id",
      "forward_positions.side",
      "forward_positions.notional_cents",
      "forward_positions.entry_ln",
      "forward_positions.opened_at",
      "trades.market_sequence",
    ])
    .execute();
  const marks = await db
    .selectFrom("marks")
    .select(["market_id", "trade_id", "ts", "value", "market_sequence"])
    .orderBy("market_id")
    .orderBy("market_sequence")
    .execute();

  const positionsByInstrument = groupBy(positions, (row) => row.instrument_id);
  const marksByMarket = groupBy(marks, (row) => row.market_id);
  for (const row of quotes) {
    const fail = (check: DealerFinding["check"], detail: string) =>
      findings.push({ id: row.id, check, detail });
    if (PARAMS_SHA256_BY_MODEL_VERSION[row.model_version] === undefined) {
      fail("quote_recompute", `model_version ${row.model_version} was never published`);
      continue;
    }
    const context: QuoteContext = { quote: row, listing: row, midLn: row.model_mid_ln };
    if (row.kind === "forward") {
      checkForwardQuote(context, positionsByInstrument.get(row.instrument_id) ?? [], fail);
    } else {
      const bookMarks = marksByMarket.get(row.market_id) ?? [];
      const expected =
        row.reason === "list"
          ? row.model_p
          : row.reason === "fill"
            ? (bookMarks.find((mark) => mark.trade_id === row.trade_id)?.value ?? null)
            : (bookMarks.filter((mark) => mark.ts <= row.posted_at).at(-1)?.value ?? null);
      if (expected === null || !close(row.price, expected)) {
        fail(
          "quote_recompute",
          `binary ${row.reason} price ${row.price}; its inputs give ${expected}`,
        );
      }
    }
  }

  const references = await verifyReferencePrices(db, PARAMS_SHA256_BY_MODEL_VERSION);
  for (const finding of references.findings) {
    findings.push({ ...finding, check: "reference_recompute" });
  }
  const links = await verifyLinkedQuestions(db);
  for (const finding of links.findings) findings.push({ ...finding, check: "linked_question" });

  return {
    midsChecked,
    quotesChecked: quotes.length,
    referencesChecked: references.checked,
    linksChecked: links.checked,
    findings,
    passed: findings.length === 0,
  };
}
