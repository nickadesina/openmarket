"use client";

import { useState } from "react";
import { formatCentsAsUsd } from "../api/money.js";

import type { ForwardExecutionResult } from "../services/dealer/execute-forward-trade.js";
import type { ExecutionResult } from "../services/execute-trade.js";
import { ApiClientError, apiRequest } from "./api.js";

/** The authoritative LMSR requote the server attaches to a binary's PRICE_MOVED rejection. */
export interface MovedPrice {
  readonly cashAmountCents: string;
  readonly shares: number;
  readonly averagePrice: number;
  readonly priceAfter: number;
  readonly currentMetricAfter: number;
  readonly expectedRedemptionQuantity: number;
  readonly expectedRedemptionCents: string;
  readonly sellableQuantity: number;
  readonly quotedAt: string;
}

/** The dealer's live quote a forward's PRICE_MOVED rejection carries. */
export interface ForwardRequote {
  readonly entryLn: number;
  readonly entryUsd: number;
  readonly collateralCents: string;
  readonly bidLn: number;
  readonly askLn: number;
  readonly quotedAt: string;
}

export type TradeFields = Readonly<Record<string, unknown>>;

/** The two order routes: an LMSR binary trade and a forward open. */
export type TradeRoute = "/api/trade" | "/api/forward/trade";
type ResultOf<Route extends TradeRoute> = Route extends "/api/trade"
  ? ExecutionResult
  : ForwardExecutionResult;

export type TradeOutcome<Result = ExecutionResult> =
  | { readonly status: "executed"; readonly result: Result }
  /** The server deterministically rejected the trade; it did not execute and inputs may be changed. */
  | {
      readonly status: "rejected";
      readonly error: ApiClientError;
      readonly movedPrice: MovedPrice | null;
      readonly forwardRequote: ForwardRequote | null;
    }
  /** Execution state is unknown (network failure, 5xx, unreadable response, or idempotency conflict); the request is kept so a retry cannot duplicate the trade. */
  | { readonly status: "unknown" };

interface PendingOrder {
  readonly key: string;
  readonly fields: TradeFields;
}

/**
 * A 4xx response is a definitive rejection: the server received the request and refused it.
 * Anything else leaves the execution state unknown and must be retried with the same key.
 * IDEMPOTENCY_CONFLICT is the exception: the key was already committed (typically by a
 * concurrent attempt), so the trade may have executed and a same-key retry replays it.
 * RATE_LIMITED is also unknown: the server refused before evaluating the trade, and an
 * earlier attempt with this key may already have executed, so only a same-key retry is safe.
 */
function isOutcomeUnknown(error: unknown): boolean {
  return (
    !(error instanceof ApiClientError) ||
    error.status === 0 ||
    error.status >= 500 ||
    error.code === "INVALID_RESPONSE" ||
    error.code === "IDEMPOTENCY_CONFLICT" ||
    error.code === "RATE_LIMITED"
  );
}

function finiteNumbers(values: readonly unknown[]): values is number[] {
  return values.every((value) => typeof value === "number" && Number.isFinite(value));
}

function movedPriceDetails(error: ApiClientError): MovedPrice | null {
  if (error.code !== "PRICE_MOVED") return null;
  const details = error.details;
  const cashAmountCents = details.cash_amount_cents;
  const expectedRedemptionCents = details.expected_redemption_cents;
  const quotedAt = details.quoted_at;
  const numbers = [
    details.shares,
    details.average_price,
    details.price_after,
    details.current_metric_after,
    details.expected_redemption_quantity,
    details.sellable_quantity,
  ];
  if (
    typeof cashAmountCents !== "string" ||
    typeof expectedRedemptionCents !== "string" ||
    typeof quotedAt !== "string" ||
    !finiteNumbers(numbers)
  ) {
    return null;
  }
  const [
    shares,
    averagePrice,
    priceAfter,
    currentMetricAfter,
    expectedRedemptionQuantity,
    sellableQuantity,
  ] = numbers;
  return {
    cashAmountCents,
    shares: shares!,
    averagePrice: averagePrice!,
    priceAfter: priceAfter!,
    currentMetricAfter: currentMetricAfter!,
    expectedRedemptionQuantity: expectedRedemptionQuantity!,
    expectedRedemptionCents,
    sellableQuantity: sellableQuantity!,
    quotedAt,
  };
}

function forwardRequoteDetails(error: ApiClientError): ForwardRequote | null {
  if (error.code !== "PRICE_MOVED") return null;
  const details = error.details;
  const numbers = [details.entry_ln, details.entry_usd, details.bid_ln, details.ask_ln];
  if (
    typeof details.collateral_cents !== "string" ||
    typeof details.quoted_at !== "string" ||
    !finiteNumbers(numbers)
  ) {
    return null;
  }
  const [entryLn, entryUsd, bidLn, askLn] = numbers;
  return {
    entryLn: entryLn!,
    entryUsd: entryUsd!,
    collateralCents: details.collateral_cents,
    bidLn: bidLn!,
    askLn: askLn!,
    quotedAt: details.quoted_at,
  };
}

async function submit<Route extends TradeRoute>(
  route: Route,
  order: PendingOrder,
): Promise<TradeOutcome<ResultOf<Route>>> {
  try {
    const result = await apiRequest<ResultOf<Route>>(route, {
      method: "POST",
      body: JSON.stringify({ ...order.fields, idempotency_key: order.key }),
    });
    return { status: "executed", result };
  } catch (error) {
    if (isOutcomeUnknown(error)) return { status: "unknown" };
    const rejection = error as ApiClientError;
    return {
      status: "rejected",
      error: rejection,
      movedPrice: route === "/api/trade" ? movedPriceDetails(rejection) : null,
      forwardRequote: route === "/api/forward/trade" ? forwardRequoteDetails(rejection) : null,
    };
  }
}

/**
 * Owns the idempotency-key lifecycle for an order route (POST /api/trade or
 * /api/forward/trade). Each `execute` sends a fresh key. While an attempt's
 * outcome is unknown the exact request (key and fields) is held as the
 * pending order; `retry` replays it byte-for-byte so a resend can only ever
 * replay the fill. The pending order is released once the server executes or
 * deterministically rejects it, or when the caller explicitly discards it.
 */
export function useTradeExecution<Route extends TradeRoute = "/api/trade">(
  route: Route = "/api/trade" as Route,
) {
  const [pending, setPending] = useState<PendingOrder | null>(null);

  async function settle(order: PendingOrder): Promise<TradeOutcome<ResultOf<Route>>> {
    const outcome = await submit(route, order);
    setPending(outcome.status === "unknown" ? order : null);
    return outcome;
  }

  /** Sends a new order. Refused while a previous order is still unresolved. */
  function execute(fields: TradeFields): Promise<TradeOutcome<ResultOf<Route>>> {
    if (pending !== null) return retry();
    return settle({ key: crypto.randomUUID(), fields });
  }

  /** Resends the unresolved order with its original key and fields. */
  function retry(): Promise<TradeOutcome<ResultOf<Route>>> {
    if (pending === null) return Promise.reject(new Error("No pending order to retry."));
    return settle(pending);
  }

  /** Abandon the unresolved order; a fill that already happened stays on the ledger. */
  function reset() {
    setPending(null);
  }

  return { execute, retry, reset, pending: pending?.fields ?? null, canRetry: pending !== null };
}

export const BINARY_STRIKE_INDEX = 0;

/** Amount entry accepts decimal cents only, then uses the server's canonical wire format. */
export function canonicalDollarAmount(text: string): string | null {
  const trimmed = text.trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(trimmed) || !(Number(trimmed) > 0)) return null;
  return Number(trimmed).toFixed(2);
}

/** One percent of slippage, rounded outward in exact integer cents. */
export function slippageCents(cashCents: string, action: "buy" | "sell"): number {
  const cents = BigInt(cashCents);
  return Number(action === "buy" ? (cents * 101n + 99n) / 100n : (cents * 99n) / 100n);
}

export function binarySlippageGuard(
  action: "buy" | "sell",
  spend: string | null,
  cashCents: string,
) {
  if (action === "buy" && spend !== null)
    return { usd: spend, cents: Math.round(Number(spend) * 100) };
  const cents = slippageCents(cashCents, action);
  return { cents, usd: formatCentsAsUsd(cents) };
}
