import { createHash, randomUUID } from "node:crypto";

import { type Kysely, sql, type Transaction } from "kysely";

import { ServiceError } from "../../api/errors.js";
import { formatCentsAsUsd, parseUsdToCents } from "../../api/money.js";
import type { ForwardTradeInput } from "../../api/schemas.js";
import { MODEL_VERSION } from "../../config/dealer.js";
import type { Database, ForwardSide, JsonObject, JsonValue } from "../../db/schema.js";
import { collateralCents, fill } from "../../engine/dealer/forward.js";
import { RULEBOOK_VERSION } from "../../engine/dealer/rulebook.js";
import { deriveAdvisoryLockKey } from "../execute-trade.js";
import { forwardQuoteRow } from "./dealer-books.js";
import {
  type ForwardBookState,
  loadForwardBook,
  loadInstrumentBook,
} from "./get-instrument-quote.js";

/**
 * Opens a forward position against the dealer's live quote (CONTRACTS.md →
 * Contract B, The dealer): notional for notional at the ask (long) or bid
 * (short), which becomes the position's F₀. Collateral N·κ, rounded up, moves
 * from the user's cash to the book's market-maker cash flow, so the replay
 * identity holds unchanged; settlement and void credit it back.
 *
 * One transaction under the idempotency key's advisory lock, like
 * /api/trade: a replay of the same key and request returns the stored
 * result verbatim; the same key on another request is a conflict. The quote
 * is computed inside the transaction with the instrument and book locked, so
 * the fill is the quote at execution, not at preview.
 */

export interface ForwardExecutionResult extends JsonObject {
  readonly kind: "forward";
  readonly trade_id: string;
  readonly position_id: string;
  readonly idempotency_key: string;
  readonly instrument_id: string;
  readonly market_id: string;
  readonly market_sequence: string;
  readonly side: ForwardSide;
  readonly notional_cents: string;
  readonly entry_ln: number;
  readonly entry_usd: number;
  readonly collateral_cents: string;
  readonly max_loss_cents: string;
  readonly max_gain_cents: string;
  readonly mid_ln: number;
  readonly bid_ln: number;
  readonly ask_ln: number;
  readonly half_spread: number;
  readonly flag_state: "normal" | "widened";
  readonly inventory_before_cents: string;
  readonly inventory_after_cents: string;
  readonly cash_balance_cents: string;
  readonly expires_at: string;
  readonly executed_at: string;
  readonly model_mid_id: string;
  readonly model_version: string;
  readonly rulebook_version: string;
}

export interface ForwardTradeOptions {
  /** The execution time; the database clock when omitted. Tests pass the fixture's calendar. */
  readonly now?: Date;
}

/** Hashes the caller and the canonical request, binding an idempotency key to both. */
export function deriveForwardTradeFingerprint(userId: string, input: ForwardTradeInput): string {
  const canonical = {
    kind: "forward",
    user_id: userId.toLowerCase(),
    instrument_id: input.instrument_id,
    side: input.side,
    notional_cents: parseUsdToCents(input.notional_usd).toString(),
    guard_mode: input.side === "long" ? "max_entry_ln" : "min_entry_ln",
    guard_value: String(input.side === "long" ? input.max_entry_ln : input.min_entry_ln),
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function isForwardExecutionResult(value: JsonValue): value is ForwardExecutionResult {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.kind === "forward" &&
    typeof value.trade_id === "string" &&
    typeof value.cash_balance_cents === "string" &&
    typeof value.entry_ln === "number"
  );
}

async function loadReplay(
  transaction: Transaction<Database>,
  idempotencyKey: string,
  userId: string,
  fingerprint: string,
): Promise<ForwardExecutionResult | undefined> {
  const existing = await transaction
    .selectFrom("trades")
    .select(["user_id", "request_fingerprint", "execution_result"])
    .where("idempotency_key", "=", idempotencyKey)
    .executeTakeFirst();
  if (existing === undefined) return undefined;
  if (
    existing.user_id.toLowerCase() !== userId.toLowerCase() ||
    existing.request_fingerprint !== fingerprint ||
    !isForwardExecutionResult(existing.execution_result)
  ) {
    throw new ServiceError(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key is bound to a different caller or request.",
    );
  }
  return existing.execution_result;
}

function quoteDetails(state: ForwardBookState, at: Date): Record<string, unknown> {
  return {
    mid_ln: state.quote.mid,
    bid_ln: state.quote.bid,
    ask_ln: state.quote.ask,
    half_spread: state.quote.halfSpread,
    max_long_notional_cents: String(state.quote.maxLongCents),
    max_short_notional_cents: String(state.quote.maxShortCents),
    flag_state: state.flagState,
    quoted_at: at.toISOString(),
  };
}

/** The fill at the live quote, or the refusal the route returns. */
function fillOrRefuse(
  state: ForwardBookState,
  input: ForwardTradeInput,
  notionalCents: number,
  at: Date,
) {
  const filled = fill(input.side, notionalCents, state.quote);
  if (!filled.ok) {
    if (filled.reason === "non_positive") {
      throw new ServiceError("INVALID_INPUT", "Notional must be positive.");
    }
    const maxCents = filled.reason === "exceeds_cap" ? filled.maxCents : 0;
    throw new ServiceError(
      "CAP_EXCEEDED",
      maxCents === 0
        ? `The dealer is not taking new ${input.side} positions: its cap is reached.`
        : `The dealer takes at most $${formatCentsAsUsd(maxCents)} more ${input.side} notional.`,
      {
        side: input.side,
        requested_notional_cents: String(notionalCents),
        max_notional_cents: String(maxCents),
        max_notional_usd: formatCentsAsUsd(maxCents),
        ...quoteDetails(state, at),
      },
    );
  }
  const moved =
    input.side === "long"
      ? filled.entryLn > input.max_entry_ln
      : filled.entryLn < input.min_entry_ln;
  if (moved) {
    throw new ServiceError("PRICE_MOVED", "The dealer's quote moved. Confirm the new price?", {
      side: input.side,
      entry_ln: filled.entryLn,
      entry_usd: Math.exp(filled.entryLn),
      collateral_cents: String(collateralCents(notionalCents, state.listing.kappa)),
      ...quoteDetails(state, at),
    });
  }
  return filled;
}

async function executionTime(transaction: Transaction<Database>, now?: Date): Promise<Date> {
  if (now !== undefined) return now;
  const { ts } = await transaction
    .selectNoFrom(sql<Date>`clock_timestamp()`.as("ts"))
    .executeTakeFirstOrThrow();
  return ts;
}

export async function executeForwardTrade(
  db: Kysely<Database>,
  userId: string,
  input: ForwardTradeInput,
  options: ForwardTradeOptions = {},
): Promise<{ result: ForwardExecutionResult; replayed: boolean }> {
  const idempotencyKey = input.idempotency_key.toLowerCase();
  return db.transaction().execute(async (transaction) => {
    const lockKey = deriveAdvisoryLockKey(idempotencyKey);
    await sql`select pg_advisory_xact_lock(${lockKey.toString()}::bigint)`.execute(transaction);
    const fingerprint = deriveForwardTradeFingerprint(userId, input);
    const replay = await loadReplay(transaction, idempotencyKey, userId, fingerprint);
    if (replay !== undefined) return { result: replay, replayed: true };

    const book = await loadInstrumentBook(transaction, input.instrument_id, true);
    // The clock is read after the book's lock, so marks keep sequence order in time.
    const at = await executionTime(transaction, options.now);
    const state = await loadForwardBook(transaction, book, at);
    const user = await transaction
      .selectFrom("users")
      .select(["id", "cash_balance_cents"])
      .where("id", "=", userId)
      .forUpdate()
      .executeTakeFirst();
    if (user === undefined) throw new ServiceError("USER_REQUIRED", "A valid user is required.");

    const notionalCents = parseUsdToCents(input.notional_usd);
    const filled = fillOrRefuse(state, input, notionalCents, at);
    const collateral = collateralCents(notionalCents, state.listing.kappa);
    const cash = BigInt(user.cash_balance_cents);
    if (cash < BigInt(collateral)) {
      throw new ServiceError("INSUFFICIENT_CASH", "Insufficient cash for the collateral.", {
        cash_balance_cents: user.cash_balance_cents,
        required_cents: String(collateral),
      });
    }
    const result = await writeTrade(transaction, {
      userId: user.id,
      idempotencyKey,
      fingerprint,
      state,
      side: input.side,
      notionalCents,
      entryLn: filled.entryLn,
      inventoryAfterCents: filled.inventoryAfterCents,
      collateral,
      cashAfter: cash - BigInt(collateral),
      at,
    });
    return { result, replayed: false };
  });
}

interface TradeWrite {
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
  readonly state: ForwardBookState;
  readonly side: ForwardSide;
  readonly notionalCents: number;
  readonly entryLn: number;
  readonly inventoryAfterCents: number;
  readonly collateral: number;
  readonly cashAfter: bigint;
  readonly at: Date;
}

/** Every row a fill writes: trade, position, mark, fill quote, user cash and the book. */
async function writeTrade(
  transaction: Transaction<Database>,
  write: TradeWrite,
): Promise<ForwardExecutionResult> {
  const { state, at } = write;
  const market = state.market;
  const sequence = (BigInt(market.last_market_sequence) + 1n).toString();
  const notionalUsd = write.notionalCents / 100;
  const delta = write.side === "long" ? [notionalUsd, 0] : [0, notionalUsd];
  const qAfter = market.q.map((value, index) => value + delta[index]!);
  const midUsd = Math.exp(state.mid.mid_ln);
  const tradeId = randomUUID();
  const positionId = randomUUID();
  const collateral = String(write.collateral);

  const result: ForwardExecutionResult = {
    kind: "forward",
    trade_id: tradeId,
    position_id: positionId,
    idempotency_key: write.idempotencyKey,
    instrument_id: state.instrument.id,
    market_id: market.id,
    market_sequence: sequence,
    side: write.side,
    notional_cents: String(write.notionalCents),
    entry_ln: write.entryLn,
    entry_usd: Math.exp(write.entryLn),
    collateral_cents: collateral,
    max_loss_cents: collateral,
    max_gain_cents: collateral,
    mid_ln: state.quote.mid,
    bid_ln: state.quote.bid,
    ask_ln: state.quote.ask,
    half_spread: state.quote.halfSpread,
    flag_state: state.flagState,
    inventory_before_cents: String(state.quote.inventoryCents),
    inventory_after_cents: String(write.inventoryAfterCents),
    cash_balance_cents: write.cashAfter.toString(),
    expires_at: state.instrument.expires_at.toISOString(),
    executed_at: at.toISOString(),
    model_mid_id: state.mid.id,
    model_version: MODEL_VERSION,
    rulebook_version: RULEBOOK_VERSION,
  };

  await transaction
    .updateTable("users")
    .set({ cash_balance_cents: write.cashAfter.toString() })
    .where("id", "=", write.userId)
    .execute();
  await transaction
    .updateTable("markets")
    .set({
      q: qAfter,
      current_metric: midUsd,
      last_market_sequence: sequence,
      mm_cash_flow_cents: (BigInt(market.mm_cash_flow_cents) + BigInt(write.collateral)).toString(),
    })
    .where("id", "=", market.id)
    .execute();
  const inserted = await transaction
    .insertInto("trades")
    .values({
      id: tradeId,
      idempotency_key: write.idempotencyKey,
      request_fingerprint: write.fingerprint,
      user_id: write.userId,
      market_id: market.id,
      market_sequence: sequence,
      action: "buy",
      contract_side: write.side,
      strike_index: -1,
      strike_value: null,
      quantity: notionalUsd,
      requested_spend_cents: null,
      engine_cost_usd: write.collateral / 100,
      cash_amount_cents: collateral,
      delta,
      q_before: market.q,
      q_after: qAfter,
      metric_before: market.current_metric,
      metric_after: midUsd,
      execution_result: result,
      created_at: at,
    })
    .onConflict((conflict) => conflict.column("idempotency_key").doNothing())
    .returning("id")
    .executeTakeFirst();
  if (inserted === undefined) {
    throw new ServiceError(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was committed by another transaction.",
    );
  }
  await transaction
    .insertInto("forward_positions")
    .values({
      id: positionId,
      instrument_id: state.instrument.id,
      user_id: write.userId,
      trade_id: tradeId,
      side: write.side,
      notional_cents: String(write.notionalCents),
      entry_ln: write.entryLn,
      collateral_cents: collateral,
      opened_at: at,
      settled_at: null,
      settle_ln: null,
      payout_cents: null,
      voided_at: null,
    })
    .execute();
  await transaction
    .insertInto("marks")
    .values({
      market_id: market.id,
      market_sequence: sequence,
      trade_id: tradeId,
      ts: at,
      value: midUsd,
    })
    .execute();
  await transaction
    .insertInto("quotes")
    .values(
      forwardQuoteRow(
        {
          instrumentId: state.instrument.id,
          postedAt: at,
          reason: "fill",
          modelMidId: state.mid.id,
          tradeId,
        },
        state.quote,
        state.flagState,
      ),
    )
    .execute();
  return result;
}
