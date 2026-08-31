"use client";

import { useEffect, useMemo, useState } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import styles from "./trade-ticket.module.css";
import {
  formatMetric,
  formatProbability,
  formatQuantity,
  formatUsdCents,
  strikeLabel,
  type BuyInputMode,
  type ExecutionResult,
  type MarketDetail,
  type QuoteResult,
  type TradeAction,
  type TradeSelection,
} from "../market-workspace/types.js";

interface TradeTicketProps {
  readonly market: MarketDetail;
  readonly selection: TradeSelection;
  readonly onAuthoritativeRefresh: () => Promise<void>;
  readonly onClose?: () => void;
}

type TicketError = { readonly code: string; readonly message: string };

function centsToUsd(cents: string): string {
  const value = Number(cents);
  return Number.isFinite(value) ? (value / 100).toFixed(2) : "0.00";
}

export function TradeTicket({ market, selection, onAuthoritativeRefresh, onClose }: TradeTicketProps) {
  const [action, setAction] = useState<TradeAction>("buy");
  const [buyMode, setBuyMode] = useState<BuyInputMode>("spend");
  const [amount, setAmount] = useState("100.00");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<TicketError | null>(null);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [username, setUsername] = useState("");
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const [movedPrice, setMovedPrice] = useState<{ readonly cashAmountCents: string; readonly shares: number } | null>(null);

  const contract = market.contracts.find((item) => item.strikeIndex === selection.strikeIndex)!;
  const selectedProbability = selection.side === "yes" ? contract.yesProbability : contract.noProbability;
  const amountLabel = action === "buy" && buyMode === "spend" ? "Spend" : "Quantity";
  const parsedAmount = Number(amount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;

  const requestFields = useMemo(() => {
    const base = {
      slug: market.company.slug,
      action,
      side: selection.side,
      strike_index: selection.strikeIndex,
    } as const;
    if (action === "buy" && buyMode === "spend") return { ...base, spend_usd: amount };
    return { ...base, quantity: parsedAmount };
  }, [action, amount, buyMode, market.company.slug, parsedAmount, selection.side, selection.strikeIndex]);

  useEffect(() => {
    setQuote(null);
    setResult(null);
    setError(null);
    setNeedsUsername(false);
    setRetryKey(null);
    setMovedPrice(null);
  }, [requestFields]);

  async function requestQuote() {
    if (!validAmount) {
      setError({ code: "INVALID_INPUT", message: "Enter an amount greater than zero." });
      return;
    }
    setQuoteLoading(true);
    setError(null);
    setResult(null);
    try {
      const nextQuote = await apiRequest<QuoteResult>("/api/quote", {
        method: "POST",
        body: JSON.stringify(requestFields),
      });
      setQuote(nextQuote);
    } catch (caught) {
      setQuote(null);
      if (caught instanceof ApiClientError) {
        if (caught.code === "USER_REQUIRED") setNeedsUsername(true);
        setError({ code: caught.code, message: caught.message });
      } else {
        setError({ code: "INTERNAL_ERROR", message: "The quote could not be loaded. Try again." });
      }
    } finally {
      setQuoteLoading(false);
    }
  }

  async function executeTrade(idempotencyKey?: string, confirmedCashAmountCents?: string) {
    if (quote === null) return;
    const key = idempotencyKey ?? crypto.randomUUID();
    setRetryKey(key);
    setExecuting(true);
    setError(null);
    setResult(null);

    const guard = action === "buy"
      ? {
          max_cost_usd: confirmedCashAmountCents !== undefined
            ? centsToUsd(confirmedCashAmountCents)
            : buyMode === "spend"
              ? amount
              : (Math.ceil(quote.engine_cost_usd * 1.01 * 100) / 100).toFixed(2),
        }
      : {
          min_proceeds_usd: confirmedCashAmountCents !== undefined
            ? centsToUsd(confirmedCashAmountCents)
            : (Math.floor(Number(quote.cash_amount_cents) * 0.99) / 100).toFixed(2),
        };

    try {
      const execution = await apiRequest<ExecutionResult>("/api/trade", {
        method: "POST",
        body: JSON.stringify({ ...requestFields, ...guard, idempotency_key: key }),
      });
      setResult(execution);
      setQuote(null);
      setRetryKey(null);
      setMovedPrice(null);
      try {
        await onAuthoritativeRefresh();
      } catch {
        setError({ code: "REFRESH_FAILED", message: "Trade completed, but live data could not refresh. Automatic polling will try again." });
      }
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        if (caught.status === 0 || caught.status >= 500 || caught.code === "INVALID_RESPONSE") {
          setError({ code: "RETRYABLE", message: "Execution status is unknown. Retry with the same request key to avoid a duplicate trade." });
        } else {
          if (caught.code === "USER_REQUIRED") {
            setNeedsUsername(true);
            setRetryKey(null);
          } else if (caught.code === "PRICE_MOVED") {
            const cashAmountCents = caught.details.cash_amount_cents;
            const shares = caught.details.shares;
            setMovedPrice(typeof cashAmountCents === "string" && typeof shares === "number"
              ? { cashAmountCents, shares }
              : null);
            setRetryKey(null);
          } else {
            setRetryKey(null);
          }
          setError({ code: caught.code, message: caught.message });
        }
      } else {
        setError({ code: "RETRYABLE", message: "Execution status is unknown. Retry with the same request key to avoid a duplicate trade." });
      }
    } finally {
      setExecuting(false);
    }
  }

  async function createUsername() {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      setError({ code: "INVALID_INPUT", message: "Use 3–20 letters, numbers, or underscores." });
      return;
    }
    setExecuting(true);
    setError(null);
    try {
      await apiRequest<unknown>("/api/user", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      try {
        await onAuthoritativeRefresh();
      } catch {
        // The signed username cookie is authoritative; normal polling can recover the account display.
      }
      setNeedsUsername(false);
      setExecuting(false);
      if (quote === null) await requestQuote();
      else await executeTrade();
    } catch (caught) {
      setError(caught instanceof ApiClientError
        ? { code: caught.code, message: caught.message }
        : { code: "INTERNAL_ERROR", message: "The username could not be saved. Try again." });
      setExecuting(false);
    }
  }

  const errorTitle = error?.code === "PRICE_MOVED"
    ? "Price moved"
    : error?.code === "INSUFFICIENT_CASH"
      ? "Insufficient cash"
      : error?.code === "INSUFFICIENT_HOLDINGS"
        ? "Insufficient holdings"
        : error?.code === "USER_REQUIRED"
          ? "Username required"
          : "Trade unavailable";

  return (
    <section className={styles.ticket} aria-labelledby="trade-ticket-title">
      <header className={styles.header}>
        <div>
          <h2 id="trade-ticket-title">Trade ticket</h2>
          <p>{selection.side.toUpperCase()} · {strikeLabel(market, selection.strikeIndex)}</p>
        </div>
        {onClose !== undefined ? <button type="button" className={styles.close} onClick={onClose} aria-label="Close trade ticket">Close</button> : null}
      </header>

      <div className={styles.body}>
        <div className={styles.contractSummary}>
          <span>Current probability</span>
          <strong>{formatProbability(selectedProbability)}</strong>
        </div>

        <div className={styles.segmented} aria-label="Trade action">
          {(["buy", "sell"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={action === item} onClick={() => setAction(item)} disabled={executing || quoteLoading}>
              {item === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>

        {action === "buy" ? (
          <div className={styles.mode}>
            <button type="button" aria-pressed={buyMode === "spend"} onClick={() => setBuyMode("spend")} disabled={executing || quoteLoading}>By spend</button>
            <button type="button" aria-pressed={buyMode === "quantity"} onClick={() => setBuyMode("quantity")} disabled={executing || quoteLoading}>By quantity</button>
          </div>
        ) : null}

        <label className={styles.field}>
          <span>{amountLabel}</span>
          <span className={styles.inputFrame}>
            {action === "buy" && buyMode === "spend" ? <span aria-hidden="true">$</span> : null}
            <input
              type="number"
              min="0"
              step={action === "buy" && buyMode === "spend" ? "0.01" : "0.000001"}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={executing || quoteLoading}
            />
          </span>
        </label>

        {quote !== null ? (
          <div className={styles.quote} aria-live="polite">
            <div><span>Quantity</span><strong>{formatQuantity(quote.quantity)}</strong></div>
            <div><span>{action === "buy" ? "Cost" : "Proceeds"}</span><strong>{formatUsdCents(quote.cash_amount_cents)}</strong></div>
            <div><span>Average price</span><strong>{formatProbability(quote.average_price)}</strong></div>
            <div><span>Price after</span><strong>{formatProbability(quote.price_after)}</strong></div>
            <div><span>Metric after</span><strong>{formatMetric(quote.current_metric_after, market.metric.kind)}</strong></div>
            {action === "sell" ? <div><span>Sellable</span><strong>{formatQuantity(quote.sellable_quantity)}</strong></div> : null}
            {quote.expected_redemption_quantity > 0 ? (
              <div>
                <span>Immediate redemption</span>
                <strong>{formatQuantity(quote.expected_redemption_quantity)} shares · {formatUsdCents(quote.expected_redemption_cents)}</strong>
              </div>
            ) : null}
            <small>Quoted {new Date(quote.quoted_at).toLocaleTimeString()}. Quotes are previews, not reservations.</small>
          </div>
        ) : null}

        {error !== null ? (
          <div className={styles.error} role="alert">
            <strong>{errorTitle}</strong>
            <p>{error.message}</p>
            {error.code === "PRICE_MOVED" && movedPrice !== null ? (
              <>
                <p>Updated quantity: {formatQuantity(movedPrice.shares)}. Updated {action === "buy" ? "cost" : "proceeds"}: {formatUsdCents(movedPrice.cashAmountCents)}.</p>
                <button type="button" onClick={() => void executeTrade(undefined, movedPrice.cashAmountCents)}>Confirm new price</button>
              </>
            ) : error.code === "PRICE_MOVED" ? (
              <button type="button" onClick={() => void requestQuote()}>Refresh quote</button>
            ) : null}
          </div>
        ) : null}

        {needsUsername ? (
          <div className={styles.username}>
            <label className={styles.field}>
              <span>Username</span>
              <span className={styles.inputFrame}>
                <input autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="market_reader" />
              </span>
            </label>
            <p>{quote === null ? "A username is required to quote a sale." : "Execution requires a username."} This resumes the same paper-money account on this browser.</p>
            <button type="button" className={styles.primary} onClick={() => void createUsername()} disabled={executing}>{quote === null ? "Save username and preview" : "Save username and trade"}</button>
          </div>
        ) : null}

        {result !== null ? (
          <div className={styles.success} role="status">
            <strong>Trade completed</strong>
            <p>{formatQuantity(result.shares)} shares at {formatProbability(result.average_price)} average. Market data has been refreshed.</p>
          </div>
        ) : null}

        {!needsUsername ? (
          quote === null ? (
            <button type="button" className={styles.primary} onClick={() => void requestQuote()} disabled={!validAmount || quoteLoading || executing}>
              {quoteLoading ? "Preparing quote…" : action === "buy" ? "Preview buy" : "Preview sell"}
            </button>
          ) : (
            <button type="button" className={styles.primary} onClick={() => void executeTrade()} disabled={executing || movedPrice !== null}>
              {executing ? "Executing…" : movedPrice !== null ? "Confirm the moved price above" : action === "buy" ? "Confirm buy" : "Confirm sell"}
            </button>
          )
        ) : null}

        {retryKey !== null && !executing && error?.code === "RETRYABLE" ? (
          <button type="button" className={styles.secondary} onClick={() => void executeTrade(retryKey)}>Retry same trade</button>
        ) : null}
      </div>
    </section>
  );
}
