"use client";

import { useState } from "react";

import type { ExecutionResult } from "../services/execute-trade.js";
import { ApiClientError, apiRequest } from "./api.js";

/** The authoritative requote the server attaches to a PRICE_MOVED rejection. */
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

export type TradeFields = Readonly<Record<string, unknown>>;

export type TradeOutcome =
  | { readonly status: "executed"; readonly result: ExecutionResult }
  /** The server deterministically rejected the trade; it did not execute and inputs may be changed. */
  | {
      readonly status: "rejected";
      readonly error: ApiClientError;
      readonly movedPrice: MovedPrice | null;
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
 */
function isOutcomeUnknown(error: unknown): boolean {
  return (
    !(error instanceof ApiClientError) ||
    error.status === 0 ||
    error.status >= 500 ||
    error.code === "INVALID_RESPONSE" ||
    error.code === "IDEMPOTENCY_CONFLICT"
  );
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
    !numbers.every((value) => typeof value === "number" && Number.isFinite(value))
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
  ] = numbers as number[];
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

async function submit(order: PendingOrder): Promise<TradeOutcome> {
  try {
    const result = await apiRequest<ExecutionResult>("/api/trade", {
      method: "POST",
      body: JSON.stringify({ ...order.fields, idempotency_key: order.key }),
    });
    return { status: "executed", result };
  } catch (error) {
    if (isOutcomeUnknown(error)) return { status: "unknown" };
    const rejection = error as ApiClientError;
    return { status: "rejected", error: rejection, movedPrice: movedPriceDetails(rejection) };
  }
}

/**
 * Owns the idempotency-key lifecycle for POST /api/trade. Each `execute` sends a fresh key.
 * While an attempt's outcome is unknown the exact request (key and fields) is held as the
 * pending order; `retry` replays it byte-for-byte so a resend can only ever replay the fill.
 * The pending order is released once the server executes or deterministically rejects it,
 * or when the caller explicitly discards it.
 */
export function useTradeExecution() {
  const [pending, setPending] = useState<PendingOrder | null>(null);

  async function settle(order: PendingOrder): Promise<TradeOutcome> {
    const outcome = await submit(order);
    setPending(outcome.status === "unknown" ? order : null);
    return outcome;
  }

  /** Sends a new order. Refused while a previous order is still unresolved. */
  function execute(fields: TradeFields): Promise<TradeOutcome> {
    if (pending !== null) return retry();
    return settle({ key: crypto.randomUUID(), fields });
  }

  /** Resends the unresolved order with its original key and fields. */
  function retry(): Promise<TradeOutcome> {
    if (pending === null) return Promise.reject(new Error("No pending order to retry."));
    return settle(pending);
  }

  /** Abandon the unresolved order; a fill that already happened stays on the ledger. */
  function reset() {
    setPending(null);
  }

  return { execute, retry, reset, pending: pending?.fields ?? null, canRetry: pending !== null };
}
