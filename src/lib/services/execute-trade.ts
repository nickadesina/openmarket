import { createHash, randomUUID } from "node:crypto";

import { type Kysely, sql, type Transaction } from "kysely";

import { ServiceError } from "../api/errors.js";
import { formatCentsAsUsd, parseUsdToCents } from "../api/money.js";
import type { TradeInput } from "../api/schemas.js";
import type {
  ContractSide,
  Database,
  JsonObject,
  JsonValue,
  MetricKind,
  TradeAction,
} from "../db/schema.js";
import { EPS } from "../engine/types.js";
import { parseRequestedAmount, previewTrade } from "./preview-trade.js";

export interface ExecutionResult extends JsonObject {
  readonly trade_id: string;
  readonly idempotency_key: string;
  readonly market_sequence: string;
  readonly action: TradeAction;
  readonly side: ContractSide;
  readonly strike_index: number;
  readonly shares: number;
  readonly engine_cost_usd: number;
  readonly cash_amount_cents: string;
  /** Ledger cash magnitude per share, after cent quantization. */
  readonly average_price: number;
  readonly price_before: number;
  readonly price_after: number;
  readonly current_metric: number;
  readonly metric_kind: MetricKind;
  readonly redemption_quantity: number;
  readonly redemption_cents: string;
  readonly cash_balance_cents: string;
  readonly sellable_quantity: number;
}

const SIGNED_BIGINT_MIN = -(1n << 63n);
const SIGNED_BIGINT_MAX = (1n << 63n) - 1n;

/** Derives the stable signed int8 key used by pg_advisory_xact_lock. */
export function deriveAdvisoryLockKey(idempotencyKey: string): bigint {
  return createHash("sha256")
    .update(idempotencyKey.toLowerCase(), "utf8")
    .digest()
    .readBigInt64BE(0);
}

/** Hashes the authenticated caller and canonical execution request for replay binding. */
export function deriveTradeRequestFingerprint(userId: string, input: TradeInput): string {
  const isSpendOrder = input.action === "buy" && "spend_usd" in input;
  const amountMode = isSpendOrder ? "spend_cents" : "quantity";
  const amountValue = isSpendOrder
    ? parseUsdToCents(input.spend_usd).toString()
    : input.quantity.toString();
  const slippageGuardMode = input.action === "buy" ? "max_cost_cents" : "min_proceeds_cents";
  const slippageGuardValue =
    input.action === "buy"
      ? parseUsdToCents(input.max_cost_usd).toString()
      : parseUsdToCents(input.min_proceeds_usd).toString();
  const canonicalRequest = {
    user_id: userId.toLowerCase(),
    slug: input.slug,
    action: input.action,
    side: input.side,
    strike_index: input.strike_index,
    amount_mode: amountMode,
    amount_value: amountValue,
    slippage_guard_mode: slippageGuardMode,
    slippage_guard_value: slippageGuardValue,
  };

  return createHash("sha256").update(JSON.stringify(canonicalRequest), "utf8").digest("hex");
}

function parseDatabaseBigint(value: string, name: string): bigint {
  if (!/^-?(?:0|[1-9]\d*)$/.test(value)) {
    throw new RangeError(`${name} is not a canonical bigint string`);
  }
  const parsed = BigInt(value);
  if (parsed < SIGNED_BIGINT_MIN || parsed > SIGNED_BIGINT_MAX) {
    throw new RangeError(`${name} is outside PostgreSQL bigint range`);
  }
  return parsed;
}

function addDatabaseBigints(left: string, right: bigint, name: string): string {
  const result = parseDatabaseBigint(left, name) + right;
  if (result < SIGNED_BIGINT_MIN || result > SIGNED_BIGINT_MAX) {
    throw new RangeError(`${name} is outside PostgreSQL bigint range`);
  }
  return result.toString();
}

function assertFiniteVector(vector: readonly number[], expectedLength: number, name: string): void {
  if (vector.length !== expectedLength) {
    throw new ServiceError("INVALID_INPUT", `${name} has an invalid length.`);
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new ServiceError("INVALID_INPUT", `${name} contains a non-finite value.`);
    }
  }
}

function invalidTrade(message: string): never {
  throw new ServiceError("INVALID_INPUT", message);
}

function isExecutionResult(value: JsonValue): value is ExecutionResult {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const stringFields = [
    "trade_id",
    "idempotency_key",
    "market_sequence",
    "cash_amount_cents",
    "redemption_cents",
    "cash_balance_cents",
  ] as const;
  const numberFields = [
    "strike_index",
    "shares",
    "engine_cost_usd",
    "average_price",
    "price_before",
    "price_after",
    "current_metric",
    "redemption_quantity",
    "sellable_quantity",
  ] as const;
  return (
    stringFields.every((field) => typeof value[field] === "string") &&
    numberFields.every(
      (field) => typeof value[field] === "number" && Number.isFinite(value[field]),
    ) &&
    (value.action === "buy" || value.action === "sell") &&
    (value.side === "yes" || value.side === "no") &&
    (value.metric_kind === "valuation_median" || value.metric_kind === "yes_probability")
  );
}

async function loadReplay(
  transaction: Transaction<Database>,
  idempotencyKey: string,
  userId: string,
  requestFingerprint: string,
): Promise<ExecutionResult | undefined> {
  const existing = await transaction
    .selectFrom("trades")
    .select(["user_id", "request_fingerprint", "execution_result"])
    .where("idempotency_key", "=", idempotencyKey)
    .executeTakeFirst();
  if (existing === undefined) return undefined;
  if (
    existing.user_id.toLowerCase() !== userId.toLowerCase() ||
    existing.request_fingerprint !== requestFingerprint
  ) {
    throw new ServiceError(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key is bound to a different caller or request.",
    );
  }
  if (!isExecutionResult(existing.execution_result)) {
    throw new ServiceError(
      "IDEMPOTENCY_CONFLICT",
      "Stored idempotent execution response is invalid.",
    );
  }
  return existing.execution_result;
}

export async function executeTrade(
  db: Kysely<Database>,
  userId: string,
  input: TradeInput,
): Promise<{ result: ExecutionResult; replayed: boolean }> {
  const idempotencyKey = input.idempotency_key.toLowerCase();
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one serializable transaction on purpose; split validation from ledger writes before growing.
  return db.transaction().execute(async (transaction) => {
    const advisoryKey = deriveAdvisoryLockKey(idempotencyKey);
    await sql`select pg_advisory_xact_lock(${advisoryKey.toString()}::bigint)`.execute(transaction);

    const requestFingerprint = deriveTradeRequestFingerprint(userId, input);
    const replay = await loadReplay(transaction, idempotencyKey, userId, requestFingerprint);
    if (replay !== undefined) {
      return { result: replay, replayed: true };
    }

    const market = await transaction
      .selectFrom("markets")
      .innerJoin("companies", "companies.id", "markets.company_id")
      .selectAll("markets")
      .where("companies.slug", "=", input.slug)
      .where("markets.status", "=", "open")
      .forUpdate("markets")
      .executeTakeFirst();

    if (market === undefined) {
      const latest = await transaction
        .selectFrom("markets")
        .innerJoin("companies", "companies.id", "markets.company_id")
        .select("markets.status")
        .where("companies.slug", "=", input.slug)
        .orderBy("markets.created_at", "desc")
        .executeTakeFirst();
      if (latest?.status === "settled") {
        throw new ServiceError("MARKET_SETTLED", "Market is settled.");
      }
      throw new ServiceError("MARKET_NOT_FOUND", "Open market not found.");
    }

    assertFiniteVector(market.q, market.n_buckets, "Market state");
    const marketSequence = addDatabaseBigints(
      market.last_market_sequence,
      1n,
      "last_market_sequence",
    );
    const { execution_ts: executionTs } = await transaction
      .selectNoFrom(sql<Date>`clock_timestamp()`.as("execution_ts"))
      .executeTakeFirstOrThrow();

    const user = await transaction
      .selectFrom("users")
      .selectAll()
      .where("id", "=", userId)
      .forUpdate()
      .executeTakeFirst();
    if (user === undefined) {
      throw new ServiceError("USER_REQUIRED", "A valid user is required.");
    }

    await transaction
      .insertInto("holdings")
      .values({
        user_id: user.id,
        market_id: market.id,
        h: new Array<number>(market.n_buckets).fill(0),
        updated_at: executionTs,
      })
      .onConflict((conflict) => conflict.columns(["user_id", "market_id"]).doNothing())
      .execute();

    const holding = await transaction
      .selectFrom("holdings")
      .selectAll()
      .where("user_id", "=", user.id)
      .where("market_id", "=", market.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    assertFiniteVector(holding.h, market.n_buckets, "Holdings");
    const holdingsBefore = holding.h.map((value) => (Math.abs(value) < EPS ? 0 : value));
    if (holdingsBefore.some((value) => value < 0)) {
      throw new ServiceError("INVALID_INPUT", "Holdings state is invalid.");
    }

    const amount = parseRequestedAmount(input);
    const requestedSpendCents = amount.spendCents ?? null;
    if (input.action === "buy" && requestedSpendCents !== null) {
      if (parseUsdToCents(input.max_cost_usd) !== requestedSpendCents) {
        invalidTrade("Spend orders require max cost to equal submitted spend.");
      }
    }

    const preview = previewTrade(
      market,
      holdingsBefore,
      { action: input.action, side: input.side, strike_index: input.strike_index },
      amount,
    );
    const strikeValue = preview.strikeValue;
    const quantity = preview.quantity;
    const engineCostUsd = preview.engineCostUsd;
    const cashAmountCents = preview.cashAmountCents;
    const delta = preview.delta;
    const qAfter = preview.qAfter;
    assertFiniteVector(qAfter, market.n_buckets, "Updated market state");
    const holdingsAfter = preview.holdingsAfter;
    const redemptionQuantity = preview.redemptionQuantity;
    const redemptionCents = preview.redemptionCents;
    const priceBefore = preview.priceBefore;
    const priceAfter = preview.priceAfter;
    const metricAfter = preview.metricAfter;
    const sellableAfter = preview.sellableAfter;

    // The slippage guard is checked after the post-trade state is known so a
    // PRICE_MOVED rejection carries the same fields as a quote: the client
    // re-presents the full consequence set, not just the new cash figure.
    const guardCents = parseUsdToCents(
      input.action === "buy" ? input.max_cost_usd : input.min_proceeds_usd,
    );
    if (input.action === "buy" ? cashAmountCents > guardCents : cashAmountCents < guardCents) {
      throw new ServiceError(
        "PRICE_MOVED",
        `Price moved. New ${input.action === "buy" ? "cost" : "proceeds"}: $${formatCentsAsUsd(cashAmountCents)}. Confirm trade?`,
        {
          cash_amount_cents: cashAmountCents.toString(),
          shares: quantity,
          average_price: Math.abs(cashAmountCents) / 100 / quantity,
          price_after: priceAfter,
          current_metric_after: metricAfter,
          expected_redemption_quantity: redemptionQuantity,
          expected_redemption_cents: redemptionCents.toString(),
          sellable_quantity: sellableAfter,
          quoted_at: executionTs.toISOString(),
        },
      );
    }

    const userCash = parseDatabaseBigint(user.cash_balance_cents, "cash_balance_cents");
    if (input.action === "buy" && userCash < BigInt(cashAmountCents)) {
      throw new ServiceError("INSUFFICIENT_CASH", "Insufficient cash balance.", {
        cash_balance_cents: user.cash_balance_cents,
        required_cents: cashAmountCents.toString(),
      });
    }

    const signedTradeCash =
      input.action === "buy" ? -BigInt(cashAmountCents) : BigInt(cashAmountCents);
    const cashBalance = userCash + signedTradeCash + BigInt(redemptionCents);
    if (cashBalance < 0n || cashBalance > SIGNED_BIGINT_MAX) {
      throw new ServiceError("INSUFFICIENT_CASH", "Insufficient cash balance.");
    }

    const mmCashDelta =
      (input.action === "buy" ? BigInt(cashAmountCents) : -BigInt(cashAmountCents)) -
      BigInt(redemptionCents);
    const mmCashFlow = addDatabaseBigints(
      market.mm_cash_flow_cents,
      mmCashDelta,
      "mm_cash_flow_cents",
    );

    const tradeId = randomUUID();
    const result: ExecutionResult = {
      trade_id: tradeId,
      idempotency_key: idempotencyKey,
      market_sequence: marketSequence,
      action: input.action,
      side: input.side,
      strike_index: input.strike_index,
      shares: quantity,
      engine_cost_usd: engineCostUsd,
      cash_amount_cents: cashAmountCents.toString(),
      average_price: Math.abs(cashAmountCents) / 100 / quantity,
      price_before: priceBefore,
      price_after: priceAfter,
      current_metric: metricAfter,
      metric_kind: market.metric_kind,
      redemption_quantity: redemptionQuantity,
      redemption_cents: redemptionCents.toString(),
      cash_balance_cents: cashBalance.toString(),
      sellable_quantity: sellableAfter,
    };

    await transaction
      .updateTable("users")
      .set({ cash_balance_cents: cashBalance.toString() })
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("markets")
      .set({
        q: qAfter,
        current_metric: metricAfter,
        last_market_sequence: marketSequence,
        mm_cash_flow_cents: mmCashFlow,
      })
      .where("id", "=", market.id)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("holdings")
      .set({ h: holdingsAfter, updated_at: executionTs })
      .where("user_id", "=", user.id)
      .where("market_id", "=", market.id)
      .executeTakeFirstOrThrow();

    const insertedTrade = await transaction
      .insertInto("trades")
      .values({
        id: tradeId,
        idempotency_key: idempotencyKey,
        request_fingerprint: requestFingerprint,
        user_id: user.id,
        market_id: market.id,
        market_sequence: marketSequence,
        action: input.action,
        contract_side: input.side,
        strike_index: input.strike_index,
        strike_value: strikeValue,
        quantity,
        requested_spend_cents: requestedSpendCents?.toString() ?? null,
        engine_cost_usd: engineCostUsd,
        cash_amount_cents: cashAmountCents.toString(),
        redemption_quantity: redemptionQuantity,
        redemption_cents: redemptionCents.toString(),
        delta,
        q_before: market.q,
        q_after: qAfter,
        metric_before: market.current_metric,
        metric_after: metricAfter,
        execution_result: result,
        created_at: executionTs,
      })
      .onConflict((conflict) => conflict.column("idempotency_key").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (insertedTrade === undefined) {
      throw new ServiceError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was committed by another transaction.",
      );
    }

    await transaction
      .insertInto("marks")
      .values({
        market_id: market.id,
        market_sequence: marketSequence,
        trade_id: tradeId,
        ts: executionTs,
        value: metricAfter,
      })
      .executeTakeFirstOrThrow();

    return { result, replayed: false };
  });
}
