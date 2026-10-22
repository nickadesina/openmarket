"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import {
  errorMessage,
  formatCents,
  formatContractPrice,
  formatDate,
  formatDateTime,
  formatForecasterName,
  formatPrice,
  formatQuantity,
  formatUsd,
  sideLabel,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { signInHref } from "../../lib/client/tournament.js";
import { type TradeOutcome, useTradeExecution } from "../../lib/client/use-trade-execution.js";
import type { ExecutionResult } from "../../lib/services/execute-trade.js";
import type {
  Portfolio,
  PortfolioBinaryPosition,
  PortfolioForwardPosition,
  PortfolioMarket,
  PortfolioTrade,
} from "../../lib/services/portfolio.js";
import type { QuoteResult } from "../../lib/services/quote.js";
import { QuoteReview } from "../quote-review/quote-review.js";
import styles from "./portfolio-page.module.css";

const HISTORY_LIMIT = 20;
const MIN_QUANTITY = 0.000001;
const FALLBACK_ERROR = "Something went wrong. Please try again.";

interface SellSelection {
  readonly market: PortfolioMarket;
  readonly position: PortfolioBinaryPosition;
}

interface SellFlowProps extends SellSelection {
  readonly onClose: () => void;
  readonly onComplete: (result: ExecutionResult) => void;
}

interface ReviewedSale {
  readonly quote: QuoteResult;
  readonly positionQuantity: number;
  readonly markPriceUsd: number;
}

/** Signed cash with the Gain/Loss word (DESIGN.md → The Arrow-and-Word Rule); zero stays muted. */
function pnl(valueUsd: number | null): {
  readonly className?: string | undefined;
  readonly text: string;
} {
  if (valueUsd === null) return { text: "Not available" };
  if (valueUsd === 0) return { className: styles.flat, text: formatUsd(0) };
  return valueUsd > 0
    ? { className: styles.positive, text: `+${formatUsd(valueUsd)}` }
    : { className: styles.negative, text: `−${formatUsd(Math.abs(valueUsd))}` };
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
      <QuoteReview
        rows={[
          { label: "Shares", value: formatQuantity(quote.quantity) },
          { label: "Average price", value: formatContractPrice(quote.average_price) },
          { label: "Estimated proceeds", value: formatCents(quote.cash_amount_cents) },
          { label: "Minimum proceeds", value: formatCents(String(minProceedsCents)) },
          ...(quote.expected_redemption_quantity > 0
            ? [
                {
                  label: "Full-set redemption",
                  value: formatCents(quote.expected_redemption_cents),
                },
              ]
            : []),
        ]}
      />
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

/** Selling binary shares back to the dealer's book, by market id. */
function SellFlow({ market, position, onClose, onComplete }: SellFlowProps) {
  const queryClient = useQueryClient();
  const [quantityText, setQuantityText] = useState(String(position.sellableQuantity));
  const [review, setReview] = useState<ReviewedSale | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const trade = useTradeExecution("/api/trade");
  const quantity = Number(quantityText);
  const quantityValid =
    Number.isFinite(quantity) &&
    quantity >= MIN_QUANTITY &&
    quantity <= position.sellableQuantity + Number.EPSILON;
  // A review is valid only for the live position and price it quoted. An
  // unknown-outcome order is exempt because retry must preserve its request.
  const settled = market.status !== "open";
  const quoteStale =
    review !== null &&
    (review.positionQuantity !== position.quantity ||
      review.markPriceUsd !== position.markPriceUsd);
  const blocked = settled
    ? "This binary has settled. Shares are paid out at settlement, not sold."
    : quoteStale
      ? "Your position or the price changed since this quote. Review a fresh quote."
      : null;
  const quote = review === null || (blocked !== null && !trade.canRetry) ? null : review.quote;
  const label = `${sideLabel(position.side)} · ${market.company.name}`;
  const fields = {
    market_id: market.marketId,
    action: "sell",
    side: position.side,
    strike_index: 0,
  } as const;

  const quoteMutation = useMutation({
    mutationFn: () =>
      apiRequest<QuoteResult>("/api/quote", {
        method: "POST",
        body: JSON.stringify({ ...fields, quantity }),
      }),
    onSuccess: (nextQuote) => {
      setReview({
        quote: nextQuote,
        positionQuantity: position.quantity,
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

  async function settleOrder(send: () => Promise<TradeOutcome<ExecutionResult>>) {
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
          ? "The price moved. Review a fresh quote before confirming the sale."
          : `The price moved. New authoritative proceeds: ${movedProceeds}. Review a fresh quote before confirming.`,
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
        ...fields,
        quantity: quote.quantity,
        min_proceeds_usd: (minProceedsCents / 100).toFixed(2),
      }),
    );
  }

  // Inputs lock while an order's outcome is unknown; only "Abandon order" releases it.
  const busy = quoteMutation.isPending || selling || trade.canRetry;
  const supportId = `sellable-${market.marketId}-${position.side}`;

  return (
    <div className={styles.sellFlow} role="group" aria-label={`Sell ${label}`}>
      <div className={styles.sellFlowHeader}>
        <div>
          <h4>Sell shares</h4>
          <p>{label}</p>
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
          aria-describedby={supportId}
        />
      </label>
      <div className={styles.fieldSupport} id={supportId}>
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

function BinaryPositionRow({
  market,
  position,
  selected,
  onSell,
  onClose,
  onComplete,
}: {
  readonly market: PortfolioMarket;
  readonly position: PortfolioBinaryPosition;
  readonly selected: boolean;
  readonly onSell: () => void;
  readonly onClose: () => void;
  readonly onComplete: (result: ExecutionResult) => void;
}) {
  const basis = position.approximateCostBasis;
  const approximatePnl = pnl(
    basis === null ? null : position.markedValueUsd - Number(basis.approximateNetCostCents) / 100,
  );
  const canSell = market.status === "open" && position.sellableQuantity >= MIN_QUANTITY;

  return (
    <li className={styles.positionRow}>
      <div className={styles.positionMain}>
        <div>
          <strong>{sideLabel(position.side)}</strong>
          <span>{formatQuantity(position.quantity)} shares</span>
        </div>
        <dl className={styles.positionMetrics}>
          <div>
            <dt>Mark</dt>
            <dd>{formatContractPrice(position.markPriceUsd)}</dd>
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
                : formatContractPrice(basis.approximateAveragePriceUsd)}
            </dd>
          </div>
          <div>
            <dt>Approx. cost basis</dt>
            <dd>{basis === null ? "Not available" : formatCents(basis.approximateNetCostCents)}</dd>
          </div>
          <div>
            <dt>Approx. P&L</dt>
            <dd className={approximatePnl.className}>{approximatePnl.text}</dd>
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

function ForwardPositionRow({ position }: { readonly position: PortfolioForwardPosition }) {
  const unrealised = pnl(Number(position.unrealisedCents) / 100);
  return (
    <li className={styles.positionRow}>
      <div className={styles.positionMain}>
        <div>
          <strong>
            {sideLabel(position.side)} · {formatCents(position.notionalCents)} notional
          </strong>
          <span>
            <Link href={`/m/${position.company.slug}`}>{position.company.name}</Link> next
            post-money
          </span>
        </div>
        <dl className={styles.positionMetrics}>
          <div>
            <dt>Entry</dt>
            <dd>{formatPrice(position.entryUsd)}</dd>
          </div>
          <div>
            <dt>Mid now</dt>
            <dd>{formatPrice(position.midUsd)}</dd>
          </div>
          <div>
            <dt>Collateral</dt>
            <dd>{formatCents(position.collateralCents)}</dd>
          </div>
          <div>
            <dt>Max gain / loss</dt>
            <dd>
              {formatCents(position.maxGainCents)} / {formatCents(position.maxLossCents)}
            </dd>
          </div>
          <div>
            <dt>Unrealised</dt>
            <dd className={unrealised.className}>{unrealised.text}</dd>
          </div>
        </dl>
        <div className={styles.positionAction}>
          <span>
            Expires <time dateTime={position.expiresAt}>{formatDate(position.expiresAt)}</time>
          </span>
          <span>Held to settlement or void</span>
        </div>
      </div>
    </li>
  );
}

function HistoryRow({ trade }: { readonly trade: PortfolioTrade }) {
  const forward = trade.metricKind === "forward_ln";
  const cash = formatCents(trade.cashAmountCents);
  const title = forward
    ? `${sideLabel(trade.side)} ${formatCents(String(Math.round(trade.quantity * 100)))} forward${trade.entryUsd === null ? "" : ` at ${formatPrice(trade.entryUsd)}`}`
    : `${trade.action === "buy" ? "Bought" : "Sold"} ${formatQuantity(trade.quantity)} ${sideLabel(trade.side)}`;

  return (
    <li className={styles.historyRow}>
      <div>
        <strong>{title}</strong>
        <span>
          {trade.company.name} · {forward ? "Forward" : "Binary"} · Sequence {trade.marketSequence}
        </span>
      </div>
      <div className={styles.historyValues}>
        <strong>
          {forward
            ? `Collateral ${cash}`
            : trade.action === "buy"
              ? `Cash debit ${cash}`
              : `Cash proceeds ${cash}`}
        </strong>
        <span suppressHydrationWarning>
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
  // The header reads the same account; after a sign-in change the page holds its
  // skeleton until the positions below belong to the account the header shows.
  const identity = useQuery({
    queryKey: queryKeys.portfolio,
    queryFn: () => apiRequest<Pick<Portfolio, "userId">>("/api/portfolio?offset=0&limit=1"),
  }).data;

  const portfolio = portfolioQuery.data;

  if (
    portfolioQuery.isLoading ||
    (identity !== undefined && portfolio !== undefined && portfolio.userId !== identity.userId)
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
        <h1>Sign in to see your portfolio</h1>
        <p>
          The tournament account is the only account. Its first visit here opens a $100,000 paper
          balance.
        </p>
        <Link className={styles.primaryButton} href={signInHref("/portfolio")}>
          Sign in
        </Link>
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

  const unrealised = pnl(Number(portfolio.forwardUnrealisedCents) / 100);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.stateLabel}>Account · {formatForecasterName(portfolio.identity)}</p>
          <h1>Portfolio</h1>
          <p>
            Forwards are marked at the model mid as settlement would credit them; binary shares at
            the book&apos;s price. Binary cost basis and P&amp;L are approximate.
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
          <dt>Forward collateral</dt>
          <dd>{formatCents(portfolio.forwardCollateralCents)}</dd>
        </div>
        <div>
          <dt>Forward unrealised</dt>
          <dd className={unrealised.className}>{unrealised.text}</dd>
        </div>
        <div>
          <dt>Binary holdings</dt>
          <dd>{formatUsd(portfolio.holdingsMarkedValueUsd)}</dd>
        </div>
        <div className={styles.accountValue}>
          <dt>Account value</dt>
          <dd>{formatUsd(portfolio.accountValueUsd)}</dd>
        </div>
      </dl>

      <section className={styles.section} aria-labelledby="forwards-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="forwards-heading" className={styles.tab}>
              Forward positions
            </h2>
            <p>
              Open forwards, held to settlement or void; there is no early close. A void refunds the
              collateral.
            </p>
          </div>
        </div>
        {portfolio.forwardPositions.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>No open forwards</h3>
            <p>Go long or short a name&apos;s next post-money from its market page.</p>
            <Link href="/" className={styles.secondaryLink}>
              Browse markets
            </Link>
          </div>
        ) : (
          <ul className={`${styles.positionList} ${styles.marketList}`}>
            {portfolio.forwardPositions.map((position) => (
              <ForwardPositionRow key={position.positionId} position={position} />
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="positions-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="positions-heading" className={styles.tab}>
              Binary holdings
            </h2>
            <p>YES and NO shares in each name&apos;s quarterly binary.</p>
          </div>
        </div>

        {portfolio.markets.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>No binary shares</h3>
            <p>Buy YES or NO from a market page. Shares appear here after execution.</p>
          </div>
        ) : (
          <div className={styles.marketList}>
            {portfolio.markets.map((market) => (
              <article key={market.marketId} className={styles.marketSection}>
                <header className={styles.marketHeader}>
                  <div>
                    <Link href={`/m/${market.company.slug}`}>{market.company.name}</Link>
                    <span>
                      {market.question ?? "Binary"}
                      {market.status === "settled" ? " · Settled" : ""}
                    </span>
                  </div>
                  <strong>{formatUsd(market.holdingsMarkedValueUsd)} marked value</strong>
                </header>
                <ul className={styles.positionList}>
                  {market.positions.map((position) => {
                    const selected =
                      selection?.market.marketId === market.marketId &&
                      selection.position.side === position.side;
                    return (
                      <BinaryPositionRow
                        key={position.side}
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
                            `Sale completed: ${formatQuantity(result.shares)} shares at ${formatContractPrice(result.average_price)} average.`,
                          );
                        }}
                      />
                    );
                  })}
                </ul>
              </article>
            ))}
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
                ? "Completed forwards, buys and sells will be recorded here."
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
