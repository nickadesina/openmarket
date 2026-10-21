"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import {
  formatCents,
  formatContractPrice,
  formatDate,
  formatDateTime,
  formatProbability,
  formatQuantity,
  formatVersion,
} from "../../lib/client/format.js";
import { signInHref } from "../../lib/client/tournament.js";
import {
  type MovedPrice,
  type TradeOutcome,
  useTradeExecution,
} from "../../lib/client/use-trade-execution.js";
import type {
  BinaryInstrumentQuote,
  BuyInputMode,
  ExecutionResult,
  QuoteResult,
  TradeAction,
} from "../market-workspace/types.js";
import { QuoteReview } from "../quote-review/quote-review.js";
import {
  ApprovalStrip,
  PendingOrderActions,
  RETRYABLE_ERROR,
  type TicketError,
} from "./approval-strip.js";
import styles from "./trade-ticket.module.css";

type BinarySide = "yes" | "no";

interface BinaryTicketProps {
  readonly binary: BinaryInstrumentQuote;
  readonly side: BinarySide;
  readonly onSideChange: (side: BinarySide) => void;
  readonly onAuthoritativeRefresh: () => Promise<void>;
}

const QUICK_SPEND_USD = ["25", "100", "500", "1000"] as const;
const QUICK_QUANTITY = ["10", "100", "500", "1000"] as const;

type TicketPhase = "idle" | "quoting" | "executing";

const ERROR_TITLES: Readonly<Record<string, string>> = {
  PRICE_MOVED: "Price moved",
  PRICE_CLAMPED: "Outside the dealer's band",
  INSTRUMENT_CLOSED: "Not trading",
  INSUFFICIENT_CASH: "Insufficient cash",
  INSUFFICIENT_HOLDINGS: "Insufficient holdings",
  USER_REQUIRED: "Sign-in required",
  RETRYABLE: "Outcome unknown",
};

/** Every figure the panel shows for a priced order, from /api/quote or from a PRICE_MOVED requote. */
interface QuoteView {
  readonly quantity: number;
  readonly cashAmountCents: string;
  readonly averagePrice: number;
  readonly priceAfter: number;
  readonly yesAfter: number;
  readonly sellableQuantity: number;
  readonly expectedRedemptionQuantity: number;
  readonly expectedRedemptionCents: string;
  readonly quotedAt: string;
  /** The bound the wire carries: max cost for buys, min proceeds for sells. */
  readonly guardCents: number;
  readonly moved: boolean;
}

/**
 * The slippage guard submitted with an order. Spend buys are bounded by the
 * spend itself; quantity buys and sells absorb 1% of movement. The same value
 * is rendered in the quote panel so the bound on the wire is the one on screen.
 */
function slippageGuard(
  action: TradeAction,
  buyMode: BuyInputMode,
  amount: string,
  quote: QuoteResult,
): { readonly usd: string; readonly cents: number } {
  if (action === "buy" && buyMode === "spend") {
    return { usd: amount, cents: Math.round(Number(amount) * 100) };
  }
  const cents =
    action === "buy"
      ? Math.ceil(quote.engine_cost_usd * 1.01 * 100)
      : Math.floor(Number(quote.cash_amount_cents) * 0.99);
  return { usd: (cents / 100).toFixed(2), cents };
}

function quoteView(quote: QuoteResult, guardCents: number): QuoteView {
  return {
    quantity: quote.quantity,
    cashAmountCents: quote.cash_amount_cents,
    averagePrice: quote.average_price,
    priceAfter: quote.price_after,
    yesAfter: quote.current_metric_after,
    sellableQuantity: quote.sellable_quantity,
    expectedRedemptionQuantity: quote.expected_redemption_quantity,
    expectedRedemptionCents: quote.expected_redemption_cents,
    quotedAt: quote.quoted_at,
    guardCents,
    moved: false,
  };
}

function movedView(moved: MovedPrice): QuoteView {
  return {
    quantity: moved.shares,
    cashAmountCents: moved.cashAmountCents,
    averagePrice: moved.averagePrice,
    priceAfter: moved.priceAfter,
    yesAfter: moved.currentMetricAfter,
    sellableQuantity: moved.sellableQuantity,
    expectedRedemptionQuantity: moved.expectedRedemptionQuantity,
    expectedRedemptionCents: moved.expectedRedemptionCents,
    quotedAt: moved.quotedAt,
    // Confirming a requote submits its exact cash figure as the bound.
    guardCents: Number(moved.cashAmountCents),
    moved: true,
  };
}

/**
 * The quarterly binary's order form (CONTRACTS.md → Contract A): YES or NO
 * on the dealer's two-outcome LMSR book, addressed by market id. A trade
 * that would move YES outside [p_floor, 1 − p_floor] is refused whole.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the ticket state machine lives in one component; extract a useBinaryOrder hook before growing.
export function BinaryTicket({
  binary,
  side,
  onSideChange,
  onAuthoritativeRefresh,
}: BinaryTicketProps) {
  const [action, setAction] = useState<TradeAction>("buy");
  const [buyMode, setBuyMode] = useState<BuyInputMode>("spend");
  const [amount, setAmount] = useState("100.00");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [phase, setPhase] = useState<TicketPhase>("idle");
  const [error, setError] = useState<TicketError | null>(null);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  // Null while post-fill data is refreshing; the fill itself is settled either way.
  const [refreshStale, setRefreshStale] = useState<boolean | null>(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [movedPrice, setMovedPrice] = useState<MovedPrice | null>(null);
  const pathname = usePathname();
  const trade = useTradeExecution("/api/trade");

  const spending = action === "buy" && buyMode === "spend";
  const amountLabel = spending ? "Spend" : "Quantity";
  const quickAmounts = spending ? QUICK_SPEND_USD : QUICK_QUANTITY;
  const parsedAmount = Number(amount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  // An order with an unknown outcome pins the ticket: its request key and
  // fields stay held until it is retried to a verdict or explicitly abandoned.
  const orderPending = trade.canRetry;
  const busy = phase !== "idle" || orderPending;

  const requestBase = {
    market_id: binary.market_id,
    action,
    side,
    strike_index: 0,
  } as const;
  const requestFields = spending
    ? { ...requestBase, spend_usd: amount }
    : { ...requestBase, quantity: parsedAmount };

  const view =
    movedPrice !== null
      ? movedView(movedPrice)
      : quote !== null
        ? quoteView(quote, slippageGuard(action, buyMode, amount, quote).cents)
        : null;

  // Any change to the request invalidates the quote and everything derived
  // from it. A pending order is not derived from the form; it survives.
  function resetTradeState() {
    setQuote(null);
    setResult(null);
    setRefreshStale(false);
    setError(null);
    setNeedsSignIn(false);
    setMovedPrice(null);
  }

  // A quote is only valid for the side and book it priced.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the priced contract changes.
  useEffect(() => {
    resetTradeState();
  }, [side, binary.market_id]);

  function changeAction(next: TradeAction) {
    if (next === action) return;
    setAction(next);
    resetTradeState();
  }

  function changeBuyMode(next: BuyInputMode) {
    if (next === buyMode) return;
    setBuyMode(next);
    resetTradeState();
  }

  function changeAmount(next: string) {
    if (next === amount) return;
    setAmount(next);
    resetTradeState();
  }

  async function requestQuote() {
    if (!validAmount) {
      setError({ code: "INVALID_INPUT", message: "Enter an amount greater than zero." });
      return;
    }
    setPhase("quoting");
    setError(null);
    setResult(null);
    setRefreshStale(false);
    try {
      setQuote(
        await apiRequest<QuoteResult>("/api/quote", {
          method: "POST",
          body: JSON.stringify(requestFields),
        }),
      );
    } catch (caught) {
      setQuote(null);
      if (caught instanceof ApiClientError) {
        if (caught.code === "USER_REQUIRED") setNeedsSignIn(true);
        setError({ code: caught.code, message: caught.message });
      } else {
        setError({ code: "INTERNAL_ERROR", message: "The quote could not be loaded. Try again." });
      }
    } finally {
      setPhase("idle");
    }
  }

  async function settleOrder(send: () => Promise<TradeOutcome<ExecutionResult>>) {
    setPhase("executing");
    setError(null);
    setResult(null);
    setRefreshStale(false);

    const outcome = await send();
    if (outcome.status === "executed") {
      setRefreshStale(null);
      setResult(outcome.result);
      setQuote(null);
      setMovedPrice(null);
      try {
        await onAuthoritativeRefresh();
        setRefreshStale(false);
      } catch {
        setRefreshStale(true);
      }
    } else if (outcome.status === "unknown") {
      setError(RETRYABLE_ERROR);
    } else {
      if (outcome.error.code === "USER_REQUIRED") setNeedsSignIn(true);
      if (outcome.error.code === "PRICE_MOVED") setMovedPrice(outcome.movedPrice);
      setError({ code: outcome.error.code, message: outcome.error.message });
    }
    setPhase("idle");
  }

  /** Sends the order priced by the panel: the original quote with its guard, or a requote at its exact figure. */
  function executeTrade() {
    if (quote === null) return Promise.resolve();
    const guardUsd =
      movedPrice !== null
        ? (Number(movedPrice.cashAmountCents) / 100).toFixed(2)
        : slippageGuard(action, buyMode, amount, quote).usd;
    const guard = action === "buy" ? { max_cost_usd: guardUsd } : { min_proceeds_usd: guardUsd };
    return settleOrder(() => trade.execute({ ...requestFields, ...guard }));
  }

  const errorTitle = (error === null ? undefined : ERROR_TITLES[error.code]) ?? "Trade unavailable";

  return (
    <div className={styles.body}>
      <p className={styles.question}>
        {binary.question}{" "}
        <span>
          Expires <time dateTime={binary.expires_at}>{formatDate(binary.expires_at)}</time>
        </span>
      </p>

      <div className={styles.sideToggle} role="group" aria-label="Contract side">
        {(["yes", "no"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={item === "yes" ? styles.sideYes : styles.sideNo}
            aria-pressed={side === item}
            onClick={() => item !== side && onSideChange(item)}
            disabled={busy}
          >
            <span>{item.toUpperCase()}</span>
            <strong>
              {formatProbability(item === "yes" ? binary.yes_price : binary.no_price)}
            </strong>
          </button>
        ))}
      </div>

      <div className={styles.segmented} role="group" aria-label="Trade action">
        {(["buy", "sell"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={action === item}
            onClick={() => changeAction(item)}
            disabled={busy}
          >
            {item === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      {action === "buy" ? (
        <div className={styles.mode}>
          {(["spend", "quantity"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={buyMode === mode}
              onClick={() => changeBuyMode(mode)}
              disabled={busy}
            >
              {mode === "spend" ? "By spend" : "By quantity"}
            </button>
          ))}
        </div>
      ) : null}

      <label className={styles.field}>
        <span>{amountLabel}</span>
        <span className={styles.inputFrame}>
          {spending ? <span aria-hidden="true">$</span> : null}
          <input
            type="number"
            min="0"
            step={spending ? "0.01" : "0.000001"}
            inputMode="decimal"
            value={amount}
            onChange={(event) => changeAmount(event.target.value)}
            disabled={busy}
          />
        </span>
      </label>
      <div
        className={styles.quickAmounts}
        role="group"
        aria-label={`Quick ${amountLabel.toLowerCase()}`}
      >
        {quickAmounts.map((value) => {
          const display = spending
            ? `$${Number(value).toLocaleString("en-US")}`
            : Number(value).toLocaleString("en-US");
          const normalized = spending ? `${value}.00` : value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={amount === normalized}
              onClick={() => changeAmount(normalized)}
              disabled={busy}
            >
              {display}
            </button>
          );
        })}
      </div>

      {view !== null ? (
        <div className={styles.quote} aria-live="polite">
          <QuoteReview
            className={styles.quoteTable}
            rows={[
              { label: "Quantity", value: formatQuantity(view.quantity) },
              {
                label: action === "buy" ? "Cost" : "Proceeds",
                value: formatCents(view.cashAmountCents),
              },
              {
                label: action === "buy" ? "Max cost" : "Min proceeds",
                value: formatCents(String(view.guardCents)),
              },
              { label: "Average price", value: formatContractPrice(view.averagePrice) },
              { label: "Price after", value: formatContractPrice(view.priceAfter) },
              { label: "YES after", value: formatProbability(view.yesAfter) },
              ...(action === "sell"
                ? [{ label: "Sellable", value: formatQuantity(view.sellableQuantity) }]
                : []),
              ...(view.expectedRedemptionQuantity > 0
                ? [
                    {
                      label: "Immediate redemption",
                      value: `${formatQuantity(view.expectedRedemptionQuantity)} shares · ${formatCents(view.expectedRedemptionCents)}`,
                    },
                  ]
                : []),
              { label: "Expiry", value: formatDate(binary.expires_at) },
              {
                label: "Model · rulebook",
                value: `${formatVersion(binary.model_version)} · ${formatVersion(binary.rulebook_version)}`,
              },
            ]}
          />
          <p className={styles.dateStamp}>
            <span>{view.moved ? "Requoted" : "Quoted"}</span>
            <time dateTime={view.quotedAt} suppressHydrationWarning>
              {formatDateTime(view.quotedAt)}
            </time>
          </p>
          <small>
            {view.moved
              ? `The market moved. Confirming submits ${action === "buy" ? "cost" : "proceeds"} of exactly ${formatCents(view.cashAmountCents)}.`
              : action === "buy"
                ? "Quotes are previews, not reservations. The order fills at or below the max cost or is returned as a requote."
                : "Quotes are previews, not reservations. The order fills at or above the min proceeds or is returned as a requote."}{" "}
            YES pays $1 a share if the event happens by expiry; NO pays otherwise.
          </small>
        </div>
      ) : null}

      {error !== null ? (
        <div className={styles.error} role="alert">
          <strong>{errorTitle}</strong>
          <p>{error.message}</p>
          {error.code === "PRICE_MOVED" && movedPrice === null ? (
            <button type="button" onClick={() => void requestQuote()}>
              Refresh quote
            </button>
          ) : null}
        </div>
      ) : null}

      {needsSignIn ? (
        <div className={styles.signIn}>
          <p>
            {quote === null ? "Quoting a sale" : "Trading"} needs a signed-in account. Your first
            trade opens a $100,000 paper balance.
          </p>
          <Link className={styles.primary} href={signInHref(pathname)}>
            Sign in to trade
          </Link>
        </div>
      ) : null}

      {result !== null ? (
        <div className={styles.success} role="status">
          <strong>Trade completed</strong>
          <p>
            {formatQuantity(result.shares)} {result.side.toUpperCase()} shares at{" "}
            {formatContractPrice(result.average_price)} average.{" "}
            {refreshStale === null
              ? "Refreshing live market data."
              : refreshStale
                ? "Displayed market data may be stale."
                : "Market data has been refreshed."}
          </p>
        </div>
      ) : null}

      {orderPending ? (
        <PendingOrderActions
          executing={phase === "executing"}
          onRetry={() => void settleOrder(trade.retry)}
          onAbandon={() => {
            trade.reset();
            setError(null);
          }}
        />
      ) : !needsSignIn ? (
        quote === null ? (
          <button
            type="button"
            className={styles.primary}
            onClick={() => void requestQuote()}
            disabled={!validAmount || busy}
          >
            {phase === "quoting"
              ? "Preparing quote…"
              : action === "buy"
                ? "Preview buy"
                : "Preview sell"}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            onClick={() => void executeTrade()}
            disabled={phase === "executing"}
          >
            {phase === "executing"
              ? "Executing…"
              : movedPrice !== null
                ? "Confirm new price"
                : action === "buy"
                  ? "Confirm buy"
                  : "Confirm sell"}
          </button>
        )
      ) : null}

      <ApprovalStrip
        quoted={view !== null || result !== null || orderPending}
        sent={phase === "executing" || orderPending || result !== null}
        filled={result !== null}
        unknown={orderPending}
      />
    </div>
  );
}
