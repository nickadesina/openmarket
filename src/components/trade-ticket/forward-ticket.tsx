"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { INITIAL_USER_BALANCE_CENTS } from "../../lib/api/money.js";

import { ApiClientError, apiRequest, POLL_INTERVAL_MS } from "../../lib/client/api.js";
import {
  formatCents,
  formatDate,
  formatDateTime,
  formatForwardNotional,
  formatPrice,
  formatVersion,
  formatWholeUsd,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { signInHref } from "../../lib/client/tournament.js";
import {
  canonicalDollarAmount,
  type ForwardRequote,
  type TradeOutcome,
  useTradeExecution,
} from "../../lib/client/use-trade-execution.js";
import type { ForwardExecutionResult, ForwardInstrumentQuote } from "../market-workspace/types.js";
import { QuoteReview } from "../quote-review/quote-review.js";
import {
  ApprovalStrip,
  PendingOrderActions,
  RETRYABLE_ERROR,
  type TicketError,
} from "./approval-strip.js";
import styles from "./trade-ticket.module.css";

type ForwardSide = "long" | "short";

interface ForwardTicketProps {
  /** The live forward from the page's listing read; the ticket polls its own fill preview. */
  readonly forward: ForwardInstrumentQuote;
  readonly side: ForwardSide;
  readonly onSideChange: (side: ForwardSide) => void;
  readonly onAuthoritativeRefresh: () => Promise<void>;
}

const QUICK_NOTIONAL_USD = ["500", "1000", "5000", "25000"] as const;

const ERROR_TITLES: Readonly<Record<string, string>> = {
  PRICE_MOVED: "Price moved",
  CAP_EXCEEDED: "Over the dealer's cap",
  INSUFFICIENT_CASH: "Insufficient cash",
  INSTRUMENT_CLOSED: "Not trading",
  USER_REQUIRED: "Sign-in required",
  RETRYABLE: "Outcome unknown",
  MARKET_SETTLED: "Market settled",
  RESTRICTED_PERSON: "Trading restricted",
};

type Phase = "idle" | "executing";

function refusalMessage(
  side: ForwardSide,
  refusal: "side_pulled" | "exceeds_cap" | null,
  maxCents: string,
): string | null {
  if (refusal === "side_pulled") {
    return `The dealer is not taking new ${side} positions: its cap is reached. The other side still fills.`;
  }
  if (refusal === "exceeds_cap") {
    return `The dealer takes at most ${formatCents(maxCents)} more ${side} notional.`;
  }
  return null;
}

/**
 * The forward's order form (CONTRACTS.md → Contract B): Long or Short, a
 * notional, the dealer's live two-way quote in dollars, and the fill the
 * dealer would give now — entry, collateral (the most it can lose), the most
 * it can gain, expiry and the versions behind the price. The bound on the
 * wire is the entry on screen: the order fills there or comes back as a
 * requote. A position is held to settlement or void.
 */
/** Delay only preview requests; never let the prior amount's preview authorize a fill. */
function usePricedNotional(notional: string | null) {
  const [priced, setPriced] = useState(notional);
  useEffect(() => {
    const timeout = setTimeout(() => setPriced(notional), 250);
    return () => clearTimeout(timeout);
  }, [notional]);
  return priced;
}

function useForwardOrder({
  forward,
  side,
  onSideChange,
  onAuthoritativeRefresh,
}: ForwardTicketProps) {
  const [notionalText, setNotionalText] = useState("1000.00");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<TicketError | null>(null);
  const [requote, setRequote] = useState<ForwardRequote | null>(null);
  const [result, setResult] = useState<ForwardExecutionResult | null>(null);
  const [refreshStale, setRefreshStale] = useState<boolean | null>(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [capMaxUsd, setCapMaxUsd] = useState<string | null>(null);
  const pathname = usePathname();
  const trade = useTradeExecution("/api/forward/trade");
  const orderPending = trade.canRetry;
  const busy = phase !== "idle" || orderPending;

  const notional = canonicalDollarAmount(notionalText);
  const pricedNotional = usePricedNotional(notional);
  const previewQuery = useQuery({
    queryKey: queryKeys.instrumentQuote(forward.instrument_id, side, pricedNotional),
    queryFn: () =>
      apiRequest<ForwardInstrumentQuote>(
        `/api/instruments/${encodeURIComponent(forward.instrument_id)}/quote?side=${side}&notional_usd=${pricedNotional}`,
      ),
    enabled: pricedNotional !== null && !orderPending,
    refetchInterval: POLL_INTERVAL_MS,
    placeholderData: keepPreviousData,
  });
  // The preview shown must be the one for this side and amount, never a stale placeholder.
  const preview =
    previewQuery.data?.fill?.side === side &&
    notional !== null &&
    previewQuery.data.fill.notional_cents === String(Math.round(Number(notional) * 100))
      ? previewQuery.data
      : null;
  const live = preview ?? forward;
  const fill = preview?.fill ?? null;
  const refusal =
    fill === null ? null : refusalMessage(side, fill.refusal, fill.max_notional_cents);

  function resetOrder() {
    setError(null);
    setRequote(null);
    setResult(null);
    setRefreshStale(false);
    setNeedsSignIn(false);
    setCapMaxUsd(null);
  }

  const orderKey = `${side}:${forward.instrument_id}`;
  const [previousOrderKey, setPreviousOrderKey] = useState(orderKey);
  if (previousOrderKey !== orderKey) {
    setPreviousOrderKey(orderKey);
    resetOrder();
  }

  function changeNotional(next: string) {
    if (next === notionalText) return;
    setNotionalText(next);
    resetOrder();
  }

  async function settleOrder(send: () => Promise<TradeOutcome<ForwardExecutionResult>>) {
    setPhase("executing");
    setError(null);
    setResult(null);
    setRefreshStale(false);
    const outcome = await send();
    if (outcome.status === "executed") {
      setRefreshStale(null);
      setResult(outcome.result);
      setRequote(null);
      try {
        await onAuthoritativeRefresh();
        setRefreshStale(false);
      } catch {
        setRefreshStale(true);
      }
    } else if (outcome.status === "unknown") {
      setError(RETRYABLE_ERROR);
    } else {
      const { code, message, details } = outcome.error;
      if (code === "USER_REQUIRED") setNeedsSignIn(true);
      if (code === "PRICE_MOVED") setRequote(outcome.forwardRequote);
      if (code === "CAP_EXCEEDED" && typeof details.max_notional_usd === "string") {
        setCapMaxUsd(details.max_notional_usd);
      }
      setError({ code, message });
    }
    setPhase("idle");
  }

  /** Sends the order priced on screen: the live entry, or the requote's exact entry. */
  function submit() {
    if (notional === null || fill === null || !fill.allowed) return Promise.resolve();
    const entryLn = requote?.entryLn ?? fill.entry_ln;
    const guard = side === "long" ? { max_entry_ln: entryLn } : { min_entry_ln: entryLn };
    return settleOrder(() =>
      trade.execute({
        instrument_id: forward.instrument_id,
        side,
        notional_usd: notional,
        ...guard,
      }),
    );
  }

  const errorTitle = (error === null ? undefined : ERROR_TITLES[error.code]) ?? "Trade unavailable";
  const reviewEntryUsd = requote?.entryUsd ?? fill?.entry_usd ?? null;
  const reviewCollateral = requote?.collateralCents ?? fill?.collateral_cents ?? null;

  return {
    forward,
    side,
    onSideChange,
    busy,
    notional,
    live,
    notionalText,
    changeNotional,
    previewQuery,
    fill,
    reviewEntryUsd,
    reviewCollateral,
    requote,
    pathname,
    refusal,
    errorTitle,
    error,
    result,
    refreshStale,
    needsSignIn,
    capMaxUsd,
    trade,
    orderPending,
    phase,
    setError,
    settleOrder,
    submit,
  };
}

function ForwardControls({ order }: { readonly order: ReturnType<typeof useForwardOrder> }) {
  const { forward, side, onSideChange, busy, notional, live, notionalText, changeNotional } = order;
  return (
    <>
      <p className={styles.question}>
        {forward.question}{" "}
        <span>
          Expires <time dateTime={forward.expires_at}>{formatDate(forward.expires_at)}</time>
        </span>
      </p>

      <div className={styles.segmented} role="group" aria-label="Forward side">
        {(["long", "short"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={side === item}
            onClick={() => item !== side && onSideChange(item)}
            disabled={busy}
          >
            {item === "long" ? "Long" : "Short"}
          </button>
        ))}
      </div>

      <dl className={styles.twoWay} aria-label="Dealer's two-way quote" aria-live="polite">
        <div data-active={side === "short" ? "true" : undefined}>
          <dt>Bid</dt>
          <dd>{formatPrice(live.bid_usd)}</dd>
        </div>
        <div>
          <dt>Mid</dt>
          <dd>{formatPrice(live.mid_usd)}</dd>
        </div>
        <div data-active={side === "long" ? "true" : undefined}>
          <dt>Ask</dt>
          <dd>{formatPrice(live.ask_usd)}</dd>
        </div>
      </dl>
      {live.flag_state === "widened" ? (
        <p className={styles.caution} role="status">
          Widened on an event flag
          {live.widened_until === null ? "" : ` until ${formatDateTime(live.widened_until)}`}: the
          spread is wider and the cap lower.
        </p>
      ) : null}

      <label className={styles.field}>
        <span>Notional</span>
        <span className={styles.inputFrame}>
          <span aria-hidden="true">$</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={notionalText}
            onChange={(event) => changeNotional(event.target.value)}
            disabled={busy}
            aria-invalid={notional === null}
          />
        </span>
      </label>
      <div className={styles.quickAmounts} role="group" aria-label="Quick notional">
        {QUICK_NOTIONAL_USD.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={notionalText === `${value}.00`}
            onClick={() => changeNotional(`${value}.00`)}
            disabled={busy}
          >
            {formatWholeUsd(Number(value))}
          </button>
        ))}
      </div>

      {notional === null ? (
        <p className={styles.inlineError} role="alert">
          Enter a dollar notional greater than zero, to the cent.
        </p>
      ) : null}
    </>
  );
}

function ForwardReview({ order }: { readonly order: ReturnType<typeof useForwardOrder> }) {
  const { side, notional, previewQuery, live, fill, reviewEntryUsd, reviewCollateral, requote } =
    order;
  return (
    <>
      {fill !== null && reviewEntryUsd !== null && reviewCollateral !== null ? (
        <div className={styles.quote} aria-live="polite">
          <QuoteReview
            className={styles.quoteTable}
            rows={[
              { label: "Notional", value: formatCents(fill.notional_cents) },
              {
                label: side === "long" ? "Entry (ask)" : "Entry (bid)",
                value: formatPrice(reviewEntryUsd),
              },
              { label: "Collateral", value: formatCents(reviewCollateral) },
              // A requote carries the collateral alone: N·κ is both bounds.
              {
                label: "Max loss",
                value: formatCents(requote?.collateralCents ?? fill.max_loss_cents),
              },
              {
                label: "Max gain",
                value: formatCents(requote?.collateralCents ?? fill.max_gain_cents),
              },
              { label: "Expiry", value: formatDate(live.expires_at) },
              {
                label: "Model · rulebook",
                value: `${formatVersion(live.model_version)} · ${formatVersion(live.rulebook_version)}`,
              },
            ]}
          />
          <p className={styles.dateStamp}>
            <span>{requote !== null ? "Requoted" : "Quoted"}</span>
            {/* ICU output differs between Node and the browser; the client value wins. */}
            <time dateTime={requote?.quotedAt ?? live.quoted_at} suppressHydrationWarning>
              {formatDateTime(requote?.quotedAt ?? live.quoted_at)}
            </time>
          </p>
          <small>
            {requote !== null
              ? `The dealer's quote moved. Confirming submits an entry of exactly ${formatPrice(requote.entryUsd)}.`
              : `Quotes are previews, not reservations: the order fills at ${formatPrice(fill.entry_usd)} or better, or comes back as a requote.`}{" "}
            The position is held to settlement or void; there is no early close. With no print by
            expiry it voids and the collateral is refunded.
          </small>
        </div>
      ) : notional !== null && previewQuery.isError ? (
        <p className={styles.inlineError} role="alert">
          {previewQuery.error instanceof ApiClientError
            ? previewQuery.error.message
            : "The dealer's quote could not be loaded."}
        </p>
      ) : notional !== null ? (
        <p className={styles.pending} role="status">
          Pricing {side} {formatForwardNotional(Number(notional))}…
        </p>
      ) : null}
    </>
  );
}

function ForwardNotices({ order }: { readonly order: ReturnType<typeof useForwardOrder> }) {
  const {
    pathname,
    fill,
    refusal,
    errorTitle,
    error,
    result,
    refreshStale,
    needsSignIn,
    capMaxUsd,
    changeNotional,
  } = order;
  return (
    <>
      {refusal !== null && error === null ? (
        <div className={styles.error} role="alert">
          <strong>
            {fill?.refusal === "side_pulled" ? "Side pulled" : "Over the dealer's cap"}
          </strong>
          <p>{refusal}</p>
          {fill?.refusal === "exceeds_cap" ? (
            <button
              type="button"
              onClick={() => changeNotional((Number(fill.max_notional_cents) / 100).toFixed(2))}
            >
              Use maximum
            </button>
          ) : null}
        </div>
      ) : null}

      {error !== null ? (
        <div className={styles.error} role="alert">
          <strong>{errorTitle}</strong>
          <p>{error.message}</p>
          {capMaxUsd !== null && Number(capMaxUsd) > 0 ? (
            <button type="button" onClick={() => changeNotional(capMaxUsd)}>
              Use maximum
            </button>
          ) : null}
        </div>
      ) : null}

      {needsSignIn ? (
        <div className={styles.signIn}>
          <p>
            Trading needs a signed-in account. Your first trade opens a{" "}
            {formatWholeUsd(Number(INITIAL_USER_BALANCE_CENTS) / 100)} paper balance.
          </p>
          <Link className={styles.primary} href={signInHref(pathname)}>
            Sign in to trade
          </Link>
        </div>
      ) : null}

      {result !== null ? (
        <div className={styles.success} role="status">
          <strong>{result.side === "long" ? "Long" : "Short"} filled</strong>
          <p>
            {formatCents(result.notional_cents)} notional at {formatPrice(result.entry_usd)};{" "}
            {formatCents(result.collateral_cents)} collateral posted, held to settlement or void.{" "}
            {refreshStale === null
              ? "Refreshing live market data."
              : refreshStale
                ? "Displayed market data may be stale."
                : "Market data has been refreshed."}{" "}
            <Link href="/portfolio">View portfolio</Link>
          </p>
        </div>
      ) : null}
    </>
  );
}

function ForwardSubmit({ order }: { readonly order: ReturnType<typeof useForwardOrder> }) {
  const {
    side,
    trade,
    orderPending,
    busy,
    fill,
    phase,
    setError,
    requote,
    result,
    needsSignIn,
    settleOrder,
    submit,
  } = order;
  return (
    <div className={styles.submitBar}>
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
        <button
          type="button"
          className={styles.primary}
          onClick={() => void submit()}
          disabled={busy || fill === null || !fill.allowed}
        >
          {phase === "executing"
            ? "Executing…"
            : requote !== null
              ? "Confirm new price"
              : side === "long"
                ? "Confirm long"
                : "Confirm short"}
        </button>
      ) : null}

      <ApprovalStrip
        quoted={fill !== null || result !== null || orderPending}
        sent={phase === "executing" || orderPending || result !== null}
        filled={result !== null}
        unknown={orderPending}
      />
    </div>
  );
}

export function ForwardTicket(props: ForwardTicketProps) {
  const order = useForwardOrder(props);
  return (
    <div className={styles.body}>
      <ForwardControls order={order} />
      <ForwardReview order={order} />
      <ForwardNotices order={order} />
      <ForwardSubmit order={order} />
    </div>
  );
}
