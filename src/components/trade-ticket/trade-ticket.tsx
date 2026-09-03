"use client";

import { useEffect, useState } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import {
  formatCents,
  formatDateTime,
  formatMetric,
  formatProbability,
  formatQuantity,
  strikeLabel,
} from "../../lib/client/format.js";
import {
  type MovedPrice,
  type TradeOutcome,
  useTradeExecution,
} from "../../lib/client/use-trade-execution.js";
import type {
  BuyInputMode,
  ExecutionResult,
  MarketDetail,
  QuoteResult,
  TradeAction,
  TradeSelection,
} from "../market-workspace/types.js";
import styles from "./trade-ticket.module.css";

interface TradeTicketProps {
  readonly market: MarketDetail;
  readonly selection: TradeSelection;
  readonly onSelectionChange: (selection: TradeSelection) => void;
  readonly onAuthoritativeRefresh: () => Promise<void>;
  readonly onClose?: () => void;
}

const QUICK_SPEND_USD = ["25", "100", "500", "1000"] as const;
const QUICK_QUANTITY = ["10", "100", "500", "1000"] as const;

type TicketError = { readonly code: string; readonly message: string };

type TicketPhase = "idle" | "quoting" | "executing";

const RETRYABLE_ERROR: TicketError = {
  code: "RETRYABLE",
  message:
    "Execution status is unknown. Retry with the same request key to avoid a duplicate trade.",
};

const ERROR_TITLES: Readonly<Record<string, string>> = {
  PRICE_MOVED: "Price moved",
  INSUFFICIENT_CASH: "Insufficient cash",
  INSUFFICIENT_HOLDINGS: "Insufficient holdings",
  USER_REQUIRED: "Username required",
  RETRYABLE: "Outcome unknown",
};

/** Every figure the panel shows for a priced order, whether the quote came from /api/quote or from a PRICE_MOVED requote. */
interface QuoteView {
  readonly quantity: number;
  readonly cashAmountCents: string;
  readonly averagePrice: number;
  readonly priceAfter: number;
  readonly currentMetricAfter: number;
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
    currentMetricAfter: quote.current_metric_after,
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
    currentMetricAfter: moved.currentMetricAfter,
    sellableQuantity: moved.sellableQuantity,
    expectedRedemptionQuantity: moved.expectedRedemptionQuantity,
    expectedRedemptionCents: moved.expectedRedemptionCents,
    quotedAt: moved.quotedAt,
    // Confirming a requote submits its exact cash figure as the bound.
    guardCents: Number(moved.cashAmountCents),
    moved: true,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the ticket state machine lives in one component; extract a useTradeTicket hook before growing.
export function TradeTicket({
  market,
  selection,
  onSelectionChange,
  onAuthoritativeRefresh,
  onClose,
}: TradeTicketProps) {
  const [action, setAction] = useState<TradeAction>("buy");
  const [buyMode, setBuyMode] = useState<BuyInputMode>("spend");
  const [amount, setAmount] = useState("100.00");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [phase, setPhase] = useState<TicketPhase>("idle");
  const [error, setError] = useState<TicketError | null>(null);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  // Null while post-fill data is refreshing; the fill itself is settled either way.
  const [refreshStale, setRefreshStale] = useState<boolean | null>(false);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [username, setUsername] = useState("");
  const [movedPrice, setMovedPrice] = useState<MovedPrice | null>(null);
  const trade = useTradeExecution();

  const contract = market.contracts.find((item) => item.strikeIndex === selection.strikeIndex);
  const isBinary = market.metric.kind === "yes_probability";
  const strikePosition = market.contracts.findIndex(
    (item) => item.strikeIndex === selection.strikeIndex,
  );
  const previousStrike = market.contracts[strikePosition - 1];
  const nextStrike = market.contracts[strikePosition + 1];
  const amountLabel = action === "buy" && buyMode === "spend" ? "Spend" : "Quantity";
  const quickAmounts = action === "buy" && buyMode === "spend" ? QUICK_SPEND_USD : QUICK_QUANTITY;
  const parsedAmount = Number(amount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  // An order with an unknown outcome pins the ticket: its request key and
  // fields stay held until it is retried to a verdict or explicitly abandoned.
  const orderPending = trade.canRetry;
  const busy = phase !== "idle" || orderPending;

  const requestBase = {
    slug: market.company.slug,
    action,
    side: selection.side,
    strike_index: selection.strikeIndex,
  } as const;
  const requestFields =
    action === "buy" && buyMode === "spend"
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
    setNeedsUsername(false);
    setMovedPrice(null);
  }

  // The contract can change from the ladder or from the controls below; a
  // quote is only valid for the contract it priced.
  const selectedSide = selection.side;
  const selectedStrikeIndex = selection.strikeIndex;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the priced contract changes.
  useEffect(() => {
    setQuote(null);
    setResult(null);
    setRefreshStale(false);
    setError(null);
    setMovedPrice(null);
  }, [selectedSide, selectedStrikeIndex]);

  function changeSide(side: TradeSelection["side"]) {
    if (side !== selection.side) onSelectionChange({ strikeIndex: selection.strikeIndex, side });
  }

  function changeStrike(strikeIndex: number) {
    if (strikeIndex !== selection.strikeIndex)
      onSelectionChange({ strikeIndex, side: selection.side });
  }

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
      setPhase("idle");
    }
  }

  async function settleOrder(send: () => Promise<TradeOutcome>) {
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
      if (outcome.error.code === "USER_REQUIRED") setNeedsUsername(true);
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

  function abandonOrder() {
    trade.reset();
    setError(null);
  }

  async function createUsername() {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      setError({ code: "INVALID_INPUT", message: "Use 3–20 letters, numbers, or underscores." });
      return;
    }
    setPhase("executing");
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
      setPhase("idle");
      if (quote === null) await requestQuote();
      else await executeTrade();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? { code: caught.code, message: caught.message }
          : { code: "INTERNAL_ERROR", message: "The username could not be saved. Try again." },
      );
      setPhase("idle");
    }
  }

  const errorTitle = (error === null ? undefined : ERROR_TITLES[error.code]) ?? "Trade unavailable";
  // 稟議 strip: each box seals when the order has provably cleared that stage.
  // Sent stays sealed while the outcome is unknown; Filled only on a server 200.
  const stages = [
    ["Quoted", view !== null || result !== null || orderPending],
    ["Sent", phase === "executing" || orderPending || result !== null],
    ["Filled", result !== null],
  ] as const;

  if (contract === undefined) return null;

  return (
    <section className={styles.ticket} aria-labelledby="trade-ticket-title">
      <header className={styles.header}>
        <div>
          <h2 id="trade-ticket-title" className={styles.tab}>
            Trade ticket
          </h2>
          <p>
            {selection.side.toUpperCase()} · {strikeLabel(market, selection.strikeIndex)}
          </p>
        </div>
        {onClose !== undefined ? (
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close trade ticket"
          >
            Close
          </button>
        ) : null}
      </header>

      <div className={styles.body}>
        <ol className={styles.approvals} aria-label="Order progress">
          {stages.map(([stage, done]) => (
            <li key={stage} className={styles.approval} aria-current={done ? "step" : undefined}>
              <span className={styles.approvalBox}>
                {done ? (
                  <span className={styles.approvalSeal}>
                    {stage === "Filled" ? "Filled" : "OK"}
                  </span>
                ) : stage === "Filled" && orderPending ? (
                  <span className={styles.approvalUnknown} role="img" aria-label="Unknown">
                    ?
                  </span>
                ) : null}
              </span>
              <span className={styles.approvalLabel}>{stage}</span>
            </li>
          ))}
        </ol>

        <div className={styles.sideToggle} role="group" aria-label="Contract side">
          {(["yes", "no"] as const).map((side) => {
            const probability = side === "yes" ? contract.yesProbability : contract.noProbability;
            return (
              <button
                key={side}
                type="button"
                className={side === "yes" ? styles.sideYes : styles.sideNo}
                aria-pressed={selection.side === side}
                onClick={() => changeSide(side)}
                disabled={busy}
              >
                <span>{side.toUpperCase()}</span>
                <strong>{formatProbability(probability)}</strong>
              </button>
            );
          })}
        </div>

        {!isBinary ? (
          <div className={styles.strikeField}>
            <span className={styles.strikeLabel} id="ticket-strike-label">
              Valuation above
            </span>
            <div className={styles.strikeControl}>
              <button
                type="button"
                className={styles.strikeStep}
                onClick={() =>
                  previousStrike !== undefined && changeStrike(previousStrike.strikeIndex)
                }
                disabled={busy || previousStrike === undefined}
                aria-label="Lower strike"
              >
                −
              </button>
              <select
                className={styles.strikeSelect}
                aria-labelledby="ticket-strike-label"
                value={selection.strikeIndex}
                onChange={(event) => changeStrike(Number(event.target.value))}
                disabled={busy}
              >
                {market.contracts.map((item) => (
                  <option key={item.strikeIndex} value={item.strikeIndex}>
                    {strikeLabel(market, item.strikeIndex)} · YES{" "}
                    {formatProbability(item.yesProbability)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.strikeStep}
                onClick={() => nextStrike !== undefined && changeStrike(nextStrike.strikeIndex)}
                disabled={busy || nextStrike === undefined}
                aria-label="Higher strike"
              >
                +
              </button>
            </div>
          </div>
        ) : null}

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
            {action === "buy" && buyMode === "spend" ? <span aria-hidden="true">$</span> : null}
            <input
              type="number"
              min="0"
              step={action === "buy" && buyMode === "spend" ? "0.01" : "0.000001"}
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
            const display =
              action === "buy" && buyMode === "spend"
                ? `$${Number(value).toLocaleString("en-US")}`
                : Number(value).toLocaleString("en-US");
            const normalized = action === "buy" && buyMode === "spend" ? `${value}.00` : value;
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
            <dl className={styles.quoteTable}>
              <div>
                <dt>Quantity</dt>
                <dd>{formatQuantity(view.quantity)}</dd>
              </div>
              <div>
                <dt>{action === "buy" ? "Cost" : "Proceeds"}</dt>
                <dd>{formatCents(view.cashAmountCents)}</dd>
              </div>
              <div>
                <dt>{action === "buy" ? "Max cost" : "Min proceeds"}</dt>
                <dd>{formatCents(String(view.guardCents))}</dd>
              </div>
              <div>
                <dt>Average price</dt>
                <dd>{formatProbability(view.averagePrice)}</dd>
              </div>
              <div>
                <dt>Price after</dt>
                <dd>{formatProbability(view.priceAfter)}</dd>
              </div>
              <div>
                <dt>Metric after</dt>
                <dd>{formatMetric(view.currentMetricAfter, market.metric.kind)}</dd>
              </div>
              {action === "sell" ? (
                <div>
                  <dt>Sellable</dt>
                  <dd>{formatQuantity(view.sellableQuantity)}</dd>
                </div>
              ) : null}
              {view.expectedRedemptionQuantity > 0 ? (
                <div>
                  <dt>Immediate redemption</dt>
                  <dd>
                    {formatQuantity(view.expectedRedemptionQuantity)} shares ·{" "}
                    {formatCents(view.expectedRedemptionCents)}
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className={styles.dateStamp}>
              <span>{view.moved ? "Requoted" : "Quoted"}</span>
              <time dateTime={view.quotedAt}>{formatDateTime(view.quotedAt)}</time>
            </p>
            <small>
              {view.moved
                ? `The market moved. Confirming submits ${action === "buy" ? "cost" : "proceeds"} of exactly ${formatCents(view.cashAmountCents)}.`
                : action === "buy"
                  ? "Quotes are previews, not reservations. The order fills at or below the max cost or is returned as a requote."
                  : "Quotes are previews, not reservations. The order fills at or above the min proceeds or is returned as a requote."}
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

        {needsUsername ? (
          <div className={styles.username}>
            <label className={styles.field}>
              <span>Username</span>
              <span className={styles.inputFrame}>
                <input
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="market_reader"
                />
              </span>
            </label>
            <p>
              {quote === null
                ? "A username is required to quote a sale."
                : "Execution requires a username."}{" "}
              This resumes the same paper-money account on this browser.
            </p>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void createUsername()}
              disabled={phase === "executing"}
            >
              {quote === null ? "Save username and preview" : "Save username and trade"}
            </button>
          </div>
        ) : null}

        {result !== null ? (
          <div className={styles.success} role="status">
            <strong>Trade completed</strong>
            <p>
              {formatQuantity(result.shares)} shares at {formatProbability(result.average_price)}{" "}
              average.{" "}
              {refreshStale === null
                ? "Refreshing live market data."
                : refreshStale
                  ? "Live data has not refreshed yet; polling will catch up."
                  : "Market data has been refreshed."}
            </p>
          </div>
        ) : null}

        {orderPending ? (
          <div className={styles.orderActions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void settleOrder(trade.retry)}
              disabled={phase === "executing"}
            >
              {phase === "executing" ? "Retrying…" : "Retry same trade"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={abandonOrder}
              disabled={phase === "executing"}
            >
              Abandon order
            </button>
            <small>
              Retrying resends the identical request; the server replays the fill if it already
              happened. Abandoning does not cancel a fill: check the portfolio.
            </small>
          </div>
        ) : !needsUsername ? (
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
      </div>
    </section>
  );
}
