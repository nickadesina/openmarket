"use client";

import { useState } from "react";

import type { ExecutionResult } from "../services/execute-trade.js";
import { ApiClientError, apiRequest } from "./api.js";

export interface MovedPrice {
  readonly cashAmountCents: string;
  readonly shares: number;
}

export type TradeOutcome =
  | { readonly status: "executed"; readonly result: ExecutionResult }
  /** The server deterministically rejected the trade; it did not execute and inputs may be changed. */
  | {
      readonly status: "rejected";
      readonly error: ApiClientError;
      readonly movedPrice: MovedPrice | null;
    }
  /** Execution state is unknown (network failure, 5xx, unreadable response, or idempotency conflict); the idempotency key is kept so a retry cannot duplicate the trade. */
  | { readonly status: "unknown" };

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
  const cashAmountCents = error.details.cash_amount_cents;
  const shares = error.details.shares;
  return typeof cashAmountCents === "string" && typeof shares === "number"
    ? { cashAmountCents, shares }
    : null;
}

/**
 * Owns the idempotency-key lifecycle for POST /api/trade: a key is generated per attempt,
 * reused while the previous attempt's outcome is unknown, and dropped once the server
 * either executes or deterministically rejects the trade.
 */
export function useTradeExecution() {
  const [retryKey, setRetryKey] = useState<string | null>(null);

  async function execute(fields: Readonly<Record<string, unknown>>): Promise<TradeOutcome> {
    const key = retryKey ?? crypto.randomUUID();
    setRetryKey(key);
    try {
      const result = await apiRequest<ExecutionResult>("/api/trade", {
        method: "POST",
        body: JSON.stringify({ ...fields, idempotency_key: key }),
      });
      setRetryKey(null);
      return { status: "executed", result };
    } catch (error) {
      if (isOutcomeUnknown(error)) return { status: "unknown" };
      const rejection = error as ApiClientError;
      setRetryKey(null);
      return { status: "rejected", error: rejection, movedPrice: movedPriceDetails(rejection) };
    }
  }

  /** Forget the pending key, e.g. when the user changes the trade inputs. */
  function reset() {
    setRetryKey(null);
  }

  return { execute, reset, canRetry: retryKey !== null };
}
