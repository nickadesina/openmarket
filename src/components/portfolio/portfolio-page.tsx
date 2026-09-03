"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import {
  contractLabel,
  errorMessage,
  formatCents,
  formatDateTime,
  formatQuantity,
  formatUsd,
  formatValuation,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { type TradeOutcome, useTradeExecution } from "../../lib/client/use-trade-execution.js";
import type { ExecutionResult } from "../../lib/services/execute-trade.js";
import type {
  Portfolio,
  PortfolioMarket,
  PortfolioPosition,
  PortfolioTrade,
} from "../../lib/services/portfolio.js";
import type { QuoteResult } from "../../lib/services/quote.js";
import { OPEN_ACCOUNT_EDITOR_EVENT } from "../app-shell/account-control.js";
import styles from "./portfolio-page.module.css";

const HISTORY_LIMIT = 20;
const MIN_QUANTITY = 0.000001;
const FALLBACK_ERROR = "Something went wrong. Please try again.";

interface SellSelection {
  readonly market: PortfolioMarket;
  readonly position: PortfolioPosition;
}

interface SellFlowProps extends SellSelection {
  readonly onClose: () => void;
  readonly onComplete: (result: ExecutionResult) => void;
}

interface ReviewedSale {
  readonly quote: QuoteResult;
  readonly positionQuantity: number;
  readonly sellableQuantity: number;
  readonly markPriceUsd: number;
}

function positionLabel(
  metricKind: PortfolioMarket["metricKind"],
  side: PortfolioPosition["side"],
  strikeValue: string | null,
): string {
  return contractLabel(
    side,
    metricKind === "yes_probability" || strikeValue === null ? null : formatValuation(strikeValue),
  );
}

function PortfolioSkeleton() {
  return (
    <div
      className={styles.skeletonPage}
      role="status"
      aria-label="Loading portfolio"
      aria-busy="true"
    >
      <div className={styles.skeletonTitle} />
      <div className={styles.skeletonSummary}>
        <div />
        <div />
        <div />
      </div>
      <div className={styles.skeletonPanel} />
      <div className={styles.skeletonPanel} />
    </div>
  );
}

function SaleReview({
  quote,
  minProceedsCents,
  working,
  pending,
  blocked,
  onDiscard,
  onSubmit,
}: {
  readonly quote: QuoteResult;
  readonly minProceedsCents: number;
  readonly working: boolean;
  /** An earlier send has an unknown outcome; submit retries it and discard abandons it. */
  readonly pending: boolean;
  readonly blocked: boolean;
  readonly onDiscard: () => void;
  readonly onSubmit: () => void;
}) {
  return (
    <div className={styles.quoteReview}>
      <dl>
        <div>
          <dt>Shares</dt>
          <dd>{formatQuantity(quote.quantity)}</dd>
        </div>
        <div>
          <dt>Average price</dt>
          <dd>{formatUsd(quote.average_price)}</dd>
        </div>
        <div>
          <dt>Estimated proceeds</dt>
          <dd>{formatCents(quote.cash_amount_cents)}</dd>
        </div>
        <div>
          <dt>Minimum proceeds</dt>
          <dd>{formatCents(String(minProceedsCents))}</dd>
        </div>
        {quote.expected_redemption_quantity > 0 ? (
          <div>
            <dt>Full-set redemption</dt>
            <dd>{formatCents(quote.expected_redemption_cents)}</dd>
          </div>
        ) : null}
      </dl>
      <p className={styles.quoteTime}>
        Quoted {formatDateTime(quote.quoted_at)}. Quotes are previews, not reservations; the sale
        fills at or above the minimum proceeds or is returned as a requote.
      </p>
      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onDiscard}
          disabled={working}
        >
          {pending ? "Abandon order" : "Edit quantity"}
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={onSubmit}
          disabled={working || (!pending && blocked)}
        >
          {working ? "Selling…" : pending ? "Retry sale" : "Sell shares"}
        </button>
      </div>
    </div>
  );
}

function SellFlow({ market, position, onClose, onComplete }: SellFlowProps) {
  const queryClient = useQueryClient();
  const [quantityText, setQuantityText] = useState(String(position.sellableQuantity));
  const [review, setReview] = useState<ReviewedSale | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const trade = useTradeExecution();
  const quantity = Number(quantityText);
  const quantityValid =
    Number.isFinite(quantity) &&
    quantity >= MIN_QUANTITY &&
    quantity <= position.sellableQuantity + Number.EPSILON;
  // A review is valid only for the live position and contract price it quoted.
  // An unknown-outcome order is exempt because retry must preserve its request.
  const settled = market.status !== "open";
  const quoteStale =
    review !== null &&
    (review.positionQuantity !== position.quantity ||
      review.sellableQuantity !== position.sellableQuantity ||
      review.markPriceUsd !== position.markPriceUsd);
  const blocked = settled
    ? "This market has settled. Positions are paid out at settlement, not sold."
    : quoteStale
      ? "Your position or market price changed since this quote. Review a fresh quote."
      : null;
  const quote = review === null || (blocked !== null && !trade.canRetry) ? null : review.quote;

  const quoteMutation = useMutation({
    mutationFn: () =>
      apiRequest<QuoteResult>("/api/quote", {
        method: "POST",
        body: JSON.stringify({
          slug: market.company.slug,
          action: "sell",
          side: position.side,
          strike_index: position.strikeIndex,
          quantity,
        }),
      }),
    onSuccess: (nextQuote) => {
      setReview({
        quote: nextQuote,
        positionQuantity: position.quantity,
        sellableQuantity: position.sellableQuantity,
        markPriceUsd: position.markPriceUsd,
      });
      setNotice(null);
    },
    onError: (error) => {
      setReview(null);
      setNotice(errorMessage(error, FALLBACK_ERROR));
    },
  });

  // Min proceeds: the bound on the wire, 1% under the quoted figure, shown in the review.
  const minProceedsCents =
    quote === null ? null : Math.floor(Number(quote.cash_amount_cents) * 0.99);

  async function settleOrder(send: () => Promise<TradeOutcome>) {
    setSelling(true);
    const outcome = await send();
    if (outcome.status === "executed") {
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
      onComplete(outcome.result);
      return;
    }
    setSelling(false);
    if (outcome.status === "unknown") {
      setNotice(
        "Execution status is unknown. Retry the sale to safely reuse the same request key.",
      );
      return;
    }
    if (outcome.error.code === "PRICE_MOVED") {
      setReview(null);
      const movedProceeds =
        outcome.movedPrice === null ? null : formatCents(outcome.movedPrice.cashAmountCents);
      setNotice(
        movedProceeds === null
          ? "The market moved. Review a fresh quote before confirming the sale."
          : `The market moved. New authoritative proceeds: ${movedProceeds}. Review a fresh quote before confirming.`,
      );
      return;
    }
    setNotice(errorMessage(outcome.error, FALLBACK_ERROR));
  }

  function sellShares() {
    // Submit-time guard against the same live snapshot the render used.
    if (quote === null || minProceedsCents === null || blocked !== null) return;
    return settleOrder(() =>
      trade.execute({
        slug: market.company.slug,
        action: "sell",
        side: position.side,
        strike_index: position.strikeIndex,
        quantity: quote.quantity,
        min_proceeds_usd: (minProceedsCents / 100).toFixed(2),
      }),
    );
  }

  // Inputs lock while an order's outcome is unknown; only "Abandon order" releases it.
  const busy = quoteMutation.isPending || selling || trade.canRetry;

  return (
    <div
      className={styles.sellFlow}
      role="group"
      aria-label={`Sell ${positionLabel(market.metricKind, position.side, position.strikeValueUsd)}`}
    >
      <div className={styles.sellFlowHeader}>
        <div>
          <h4>Sell shares</h4>
          <p>{positionLabel(market.metricKind, position.side, position.strikeValueUsd)}</p>
        </div>
        <button
          type="button"
          className={styles.textButton}
          onClick={onClose}
          disabled={quoteMutation.isPending || selling}
        >
          Close
        </button>
      </div>

      <label className={styles.field}>
        <span>Quantity</span>
        <input
          inputMode="decimal"
          autoComplete="off"
          value={quantityText}
          min={MIN_QUANTITY}
          max={position.sellableQuantity}
          step="any"
          onChange={(event) => {
            setQuantityText(event.target.value);
            setReview(null);
            setNotice(null);
          }}
          disabled={busy}
          aria-describedby={`sellable-${market.marketId}-${position.side}-${position.strikeIndex}`}
        />
      </label>
      <div
        className={styles.fieldSupport}
        id={`sellable-${market.marketId}-${position.side}-${position.strikeIndex}`}
      >
        <span>Sellable: {formatQuantity(position.sellableQuantity)} shares</span>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => {
            setQuantityText(String(position.sellableQuantity));
            setReview(null);
          }}
          disabled={busy}
        >
          Use maximum
        </button>
      </div>

      {quote === null ? (
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!quantityValid || busy || settled}
          onClick={() => quoteMutation.mutate()}
        >
          {quoteMutation.isPending ? "Getting quote…" : "Review sale"}
        </button>
      ) : (
        <SaleReview
          quote={quote}
          minProceedsCents={minProceedsCents!}
          working={quoteMutation.isPending || selling}
          pending={trade.canRetry}
          blocked={blocked !== null}
          onDiscard={() => {
            setReview(null);
            setNotice(null);
            trade.reset();
          }}
          onSubmit={() => void (trade.canRetry ? settleOrder(trade.retry) : sellShares())}
        />
      )}

      {notice !== null ? (
        <p className={styles.inlineError} role="alert">
          {notice}
        </p>
      ) : blocked !== null && !trade.canRetry ? (
        <p className={styles.inlineError} role="status">
          {blocked}
        </p>
      ) : null}
    </div>
  );
}

function PositionRow({
  market,
  position,
  selected,
  onSell,
  onClose,
  onComplete,
}: {
  readonly market: PortfolioMarket;
  readonly position: PortfolioPosition;
  readonly selected: boolean;
  readonly onSell: () => void;
  readonly onClose: () => void;
  readonly onComplete: (result: ExecutionResult) => void;
}) {
  const basis = position.approximateCostBasis;
  const approximatePnl =
    basis === null ? null : position.markedValueUsd - Number(basis.approximateNetCostCents) / 100;
  const pnlDisplay =
    approximatePnl === null
      ? { className: undefined, text: "Not available" }
      : approximatePnl >= 0
        ? { className: styles.positive, text: `+${formatUsd(Math.abs(approximatePnl))}` }
        : { className: styles.negative, text: `−${formatUsd(Math.abs(approximatePnl))}` };
  const canSell = market.status === "open" && position.sellableQuantity >= MIN_QUANTITY;

  return (
    <li className={styles.positionRow}>
      <div className={styles.positionMain}>
        <div>
          <strong>
            {positionLabel(market.metricKind, position.side, position.strikeValueUsd)}
          </strong>
          <span>{formatQuantity(position.quantity)} shares</span>
        </div>
        <dl className={styles.positionMetrics}>
          <div>
            <dt>Mark</dt>
            <dd>{formatUsd(position.markPriceUsd)}</dd>
          </div>
          <div>
            <dt>Marked value</dt>
            <dd>{formatUsd(position.markedValueUsd)}</dd>
          </div>
          <div>
            <dt>Approx. avg. price</dt>
            <dd>
              {basis?.approximateAveragePriceUsd == null
                ? "Not available"
                : formatUsd(basis.approximateAveragePriceUsd)}
            </dd>
          </div>
          <div>
            <dt>Approx. cost basis</dt>
            <dd>{basis === null ? "Not available" : formatCents(basis.approximateNetCostCents)}</dd>
          </div>
          <div>
            <dt>Approx. P&L</dt>
            <dd className={pnlDisplay.className}>{pnlDisplay.text}</dd>
          </div>
        </dl>
        <div className={styles.positionAction}>
          <span>{formatQuantity(position.sellableQuantity)} sellable</span>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onSell}
            disabled={!canSell}
            aria-expanded={selected}
          >
            {market.status === "settled" ? "Settled" : canSell ? "Sell" : "No shares to sell"}
          </button>
        </div>
      </div>
      {selected ? (
        <SellFlow market={market} position={position} onClose={onClose} onComplete={onComplete} />
      ) : null}
    </li>
  );
}

function HistoryRow({ trade }: { readonly trade: PortfolioTrade }) {
  const direction = trade.action === "buy" ? "Bought" : "Sold";
  const marketLabel = contractLabel(
    trade.side,
    trade.strikeValueUsd === null ? null : formatValuation(trade.strikeValueUsd),
  );
  const cash = formatCents(trade.cashAmountCents);

  return (
    <li className={styles.historyRow}>
      <div>
        <strong>
          {direction} {formatQuantity(trade.quantity)} {marketLabel}
        </strong>
        <span>
          {trade.company.name} · Sequence {trade.marketSequence}
        </span>
      </div>
      <div className={styles.historyValues}>
        <strong>{trade.action === "buy" ? `Cash debit ${cash}` : `Cash proceeds ${cash}`}</strong>
        <span>
          {trade.redemptionQuantity > 0
            ? `${formatCents(trade.redemptionCents)} redeemed · ${formatDateTime(trade.createdAt)}`
            : formatDateTime(trade.createdAt)}
        </span>
      </div>
    </li>
  );
}

export function PortfolioPage() {
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<SellSelection | null>(null);
  const [completion, setCompletion] = useState<string | null>(null);

  const portfolioQuery = useQuery({
    queryKey: [...queryKeys.portfolio, offset, HISTORY_LIMIT],
    queryFn: () => apiRequest<Portfolio>(`/api/portfolio?offset=${offset}&limit=${HISTORY_LIMIT}`),
  });
  // The header seeds this identity the instant an account switches; the page holds
  // its skeleton until the positions below belong to that same user.
  const identity = useQuery({
    queryKey: queryKeys.portfolio,
    queryFn: () => apiRequest<Pick<Portfolio, "username">>("/api/portfolio?offset=0&limit=1"),
  }).data;

  const portfolio = portfolioQuery.data;
  const hasPositions =
    portfolio?.markets.some(
      (market) =>
        market.positions.length > 0 || market.residualExposure.buckets.some((value) => value > 0),
    ) ?? false;

  if (
    portfolioQuery.isLoading ||
    (identity !== undefined && portfolio !== undefined && portfolio.username !== identity.username)
  ) {
    return <PortfolioSkeleton />;
  }

  if (
    portfolioQuery.error instanceof ApiClientError &&
    portfolioQuery.error.code === "USER_REQUIRED"
  ) {
    return (
      <section className={styles.statePanel}>
        <p className={styles.stateLabel}>Portfolio access</p>
        <h1>Open your paper account</h1>
        <p>Enter a username to open or resume a paper account in this browser.</p>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => window.dispatchEvent(new Event(OPEN_ACCOUNT_EDITOR_EVENT))}
        >
          Enter username
        </button>
      </section>
    );
  }

  if (portfolioQuery.isError || portfolio === undefined) {
    return (
      <section className={styles.statePanel}>
        <p className={styles.stateLabel}>Portfolio unavailable</p>
        <h1>We could not load your account</h1>
        <p>{errorMessage(portfolioQuery.error, FALLBACK_ERROR)}</p>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => portfolioQuery.refetch()}
        >
          Retry portfolio
        </button>
      </section>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.stateLabel}>Account · @{portfolio.username}</p>
          <h1>Portfolio</h1>
          <p>
            Marked values use the latest market distribution. Cost basis and P&amp;L are
            approximate.
          </p>
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => portfolioQuery.refetch()}
          disabled={portfolioQuery.isFetching}
        >
          {portfolioQuery.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {completion !== null ? (
        <div className={styles.successNotice} role="status">
          <span>{completion}</span>
          <button type="button" className={styles.textButton} onClick={() => setCompletion(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <dl className={styles.summaryBand} aria-label="Portfolio summary">
        <div>
          <dt>Cash</dt>
          <dd>{formatCents(portfolio.cashBalanceCents)}</dd>
        </div>
        <div>
          <dt>Holdings mark</dt>
          <dd>{formatUsd(portfolio.holdingsMarkedValueUsd)}</dd>
        </div>
        <div className={styles.accountValue}>
          <dt>Account value</dt>
          <dd>{formatUsd(portfolio.accountValueUsd)}</dd>
        </div>
      </dl>

      <section className={styles.section} aria-labelledby="positions-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="positions-heading" className={styles.tab}>
              Positions
            </h2>
            <p>Canonical holdings decomposed into recognizable contracts.</p>
          </div>
        </div>

        {!hasPositions ? (
          <div className={styles.emptyState}>
            <h3>No open exposure</h3>
            <p>
              Buy shares from a market to build a position. Trades will appear here after execution.
            </p>
            <Link href="/" className={styles.secondaryLink}>
              Browse markets
            </Link>
          </div>
        ) : (
          <div className={styles.marketList}>
            {portfolio.markets.map((market) => {
              const residualBuckets = market.residualExposure.buckets.filter((value) => value > 0);
              if (market.positions.length === 0 && residualBuckets.length === 0) return null;
              return (
                <article key={market.marketId} className={styles.marketSection}>
                  <header className={styles.marketHeader}>
                    <div>
                      <Link href={`/m/${market.company.slug}`}>{market.company.name}</Link>
                      <span>{market.status === "settled" ? "Settled market" : "Open market"}</span>
                    </div>
                    <strong>{formatUsd(market.holdingsMarkedValueUsd)} marked value</strong>
                  </header>
                  {market.positions.length > 0 ? (
                    <ul className={styles.positionList}>
                      {market.positions.map((position) => {
                        const selected =
                          selection?.market.marketId === market.marketId &&
                          selection.position.side === position.side &&
                          selection.position.strikeIndex === position.strikeIndex;
                        return (
                          <PositionRow
                            key={`${position.side}-${position.strikeIndex}`}
                            market={market}
                            position={position}
                            selected={selected}
                            onSell={() => {
                              setCompletion(null);
                              setSelection({ market, position });
                            }}
                            onClose={() => setSelection(null)}
                            onComplete={(result) => {
                              setSelection(null);
                              setCompletion(
                                `Sale completed: ${formatQuantity(result.shares)} shares at ${formatUsd(result.average_price)} average.`,
                              );
                            }}
                          />
                        );
                      })}
                    </ul>
                  ) : null}
                  {residualBuckets.length > 0 ? (
                    <details className={styles.residual}>
                      <summary>
                        <span>Other bucket exposure</span>
                        <strong>{formatUsd(market.residualExposure.markedValueUsd)}</strong>
                      </summary>
                      <p>
                        Residual vector exposure that cannot be represented as a single YES or NO
                        contract.
                      </p>
                      <ol>
                        {market.residualExposure.buckets.map((quantity, index) =>
                          quantity > 0 ? (
                            // biome-ignore lint/suspicious/noArrayIndexKey: the index is the bucket's identity.
                            <li key={index}>
                              <span>Bucket {index + 1}</span>
                              <span>{formatQuantity(quantity)} shares</span>
                            </li>
                          ) : null,
                        )}
                      </ol>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="history-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="history-heading" className={styles.tab}>
              Trade history
            </h2>
            <p>Newest trades first.</p>
          </div>
          {offset > 0 ? <span>Showing {offset + 1} onward</span> : null}
        </div>

        {portfolio.tradeHistory.items.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>{offset === 0 ? "No trades yet" : "No more trades"}</h3>
            <p>
              {offset === 0
                ? "Completed buys and sells will be recorded here."
                : "Return to the previous page to review newer activity."}
            </p>
          </div>
        ) : (
          <ul className={styles.historyList}>
            {portfolio.tradeHistory.items.map((trade) => (
              <HistoryRow key={trade.id} trade={trade} />
            ))}
          </ul>
        )}

        <nav className={styles.pagination} aria-label="Trade history pages">
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={offset === 0 || portfolioQuery.isFetching}
            onClick={() => {
              setSelection(null);
              setOffset(Math.max(0, offset - HISTORY_LIMIT));
            }}
          >
            Newer trades
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={portfolio.tradeHistory.nextOffset === null || portfolioQuery.isFetching}
            onClick={() => {
              setSelection(null);
              setOffset(portfolio.tradeHistory.nextOffset ?? 0);
            }}
          >
            Older trades
          </button>
        </nav>
      </section>
    </div>
  );
}
