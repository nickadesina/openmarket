"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { apiRequest, POLL_INTERVAL_MS } from "../../lib/client/api.js";
import {
  formatDate,
  formatPrice,
  formatProbability,
  formatValuation,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { MarketDetail } from "../../lib/services/get-market.js";
import type {
  MarketListHistoryPoint,
  MarketListItem,
  MarketListResult,
} from "../../lib/services/list-markets.js";
import { CompanyLogo } from "../company-logo/company-logo.js";
import { MovementArrow } from "../icons/icons.js";
import styles from "./market-board.module.css";

const SPARKLINE_WIDTH = 120;
const SPARKLINE_HEIGHT = 32;
const SPARKLINE_PADDING = 2;

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCompactUsd(value: number): string {
  return `$${compactNumberFormatter.format(value)}`;
}

function formatMetric(market: MarketListItem, value = market.metric.current): string {
  return market.metric.format === "usd" ? formatPrice(value) : `${(value * 100).toFixed(1)}%`;
}

function formatChange(market: MarketListItem): {
  readonly direction: "up" | "down" | "flat";
  readonly label: string;
} {
  const change = market.metric.change24Hours;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const amount =
    market.metric.format === "usd"
      ? formatPrice(Math.abs(change))
      : `${(Math.abs(change) * 100).toFixed(1)} pts`;

  return {
    direction,
    label:
      direction === "flat" ? `Flat ${amount}` : `${direction === "up" ? "Up" : "Down"} ${amount}`,
  };
}

function sparklinePath(points: readonly MarketListHistoryPoint[]): string | null {
  if (points.length < 2) {
    return null;
  }

  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  const usableHeight = SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2;
  const usableWidth = SPARKLINE_WIDTH - SPARKLINE_PADDING * 2;

  return points
    .map((point, index) => {
      const x = SPARKLINE_PADDING + (index / (points.length - 1)) * usableWidth;
      const normalized = span === 0 ? 0.5 : (point.value - minimum) / span;
      const y = SPARKLINE_PADDING + (1 - normalized) * usableHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function Sparkline({ market }: { readonly market: MarketListItem }) {
  const path = sparklinePath(market.history);
  if (path === null) {
    return <span className={styles.noHistory}>No history</span>;
  }

  const first = market.history[0]!;
  const last = market.history.at(-1)!;
  const summary = `${market.metric.label} moved from ${formatMetric(market, first.value)} to ${formatMetric(market, last.value)} across ${market.history.length} observations.`;

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={summary}
    >
      <path
        className={styles.sparklineBaseline}
        d={`M0 ${SPARKLINE_HEIGHT - 1} H${SPARKLINE_WIDTH}`}
      />
      <path className={styles.sparklineLine} d={path} />
    </svg>
  );
}

function InlineLadder({ market }: { readonly market: MarketListItem }) {
  const slug = market.company.slug;
  const detailQuery = useQuery({
    queryKey: queryKeys.market(slug),
    queryFn: () => apiRequest<MarketDetail>(`/api/markets/${encodeURIComponent(slug)}`),
    refetchInterval: POLL_INTERVAL_MS,
  });

  if (detailQuery.isPending) {
    return (
      <div className={styles.ladderState} role="status" aria-busy="true">
        Loading probabilities…
      </div>
    );
  }

  if (detailQuery.isError) {
    return (
      <div className={styles.ladderState} role="alert">
        Probabilities are unavailable right now.
      </div>
    );
  }

  const allContracts = detailQuery.data.contracts;
  const isBinary = detailQuery.data.metric.kind === "yes_probability";
  // The board's inline ladder is a summary: a 12-row window centered on the
  // money (the strike whose YES probability sits nearest 50%), so the
  // expansion shows the contested region rather than a pinned tail.
  const pivot = allContracts.reduce(
    (best, contract, index) =>
      Math.abs(contract.yesProbability - 0.5) < Math.abs(allContracts[best]!.yesProbability - 0.5)
        ? index
        : best,
    0,
  );
  const windowStart = Math.max(0, Math.min(pivot - 6, allContracts.length - 12));
  const contracts = allContracts.slice(windowStart, windowStart + 12);
  const omitted = allContracts.length - contracts.length;
  const pivotStrike = allContracts[pivot]?.strikeIndex;
  const split = Math.ceil(contracts.length / 2);
  const columns = [contracts.slice(0, split), contracts.slice(split)].filter(
    (column) => column.length > 0,
  );

  return (
    <div className={styles.ladderWrap}>
      <div className={styles.ladderColumns}>
        {columns.map((column, columnIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional halves of one ladder.
          <table className={styles.ladderTable} key={columnIndex}>
            <caption className={styles.visuallyHidden}>
              {market.company.name} probabilities by valuation strike
              {columns.length > 1 ? ` (part ${columnIndex + 1})` : ""}
            </caption>
            <thead>
              <tr>
                <th scope="col">{isBinary ? "Contract" : "Valuation above"}</th>
                <th scope="col" className={styles.ladderPct}>
                  YES
                </th>
                <th scope="col" className={styles.ladderPct}>
                  NO
                </th>
              </tr>
            </thead>
            <tbody>
              {column.map((contract) => (
                <tr
                  key={contract.strikeIndex}
                  className={
                    contract.strikeIndex === pivotStrike ? styles.ladderPivotRow : undefined
                  }
                >
                  <th scope="row">
                    {contract.strikeValueUsd === null
                      ? "Outcome"
                      : formatValuation(contract.strikeValueUsd)}
                  </th>
                  <td className={`${styles.ladderPct} ${styles.ladderYes}`}>
                    {formatProbability(contract.yesProbability)}
                  </td>
                  <td className={styles.ladderPct}>{formatProbability(contract.noProbability)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      <Link className={styles.ladderLink} href={`/m/${slug}`}>
        {omitted > 0
          ? `All ${allContracts.length} strikes in the ${market.company.name} market ›`
          : `Open ${market.company.name} market ›`}
      </Link>
    </div>
  );
}

function MarketRow({
  market,
  expanded,
  onToggle,
}: {
  readonly market: MarketListItem;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const movement = formatChange(market);
  const anchorValue =
    market.anchor === null ? null : formatCompactUsd(Number(market.anchor.valuationUsd));

  return (
    <tr className={styles.marketRow}>
      <td className={styles.expandCell}>
        <button
          type="button"
          className={styles.expandButton}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} ${market.company.name} probability ladder`}
          onClick={onToggle}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" className={styles.expandGlyph}>
            <path
              d="M4 2.5 L8 6 L4 9.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </td>
      <th className={styles.identityCell} scope="row">
        <div className={styles.identity}>
          <CompanyLogo name={market.company.name} logoPath={market.company.logoPath} size="lg" />
          <span>
            <Link className={styles.marketLink} href={`/m/${market.company.slug}`}>
              {market.company.name}
            </Link>
            <span className={styles.metricLabel}>{market.metric.label}</span>
          </span>
        </div>
      </th>
      <td className={styles.metricCell} data-label="Current">
        <strong className={styles.metricValue}>{formatMetric(market)}</strong>
      </td>
      <td className={styles.changeCell} data-label="24h change">
        <span className={styles[movement.direction]}>
          <MovementArrow direction={movement.direction} /> {movement.label}
        </span>
      </td>
      <td className={styles.historyCell} data-label="History">
        <Sparkline market={market} />
      </td>
      <td className={styles.anchorCell} data-label="Public anchor">
        {market.anchor === null ? (
          <span className={styles.unavailable}>Not published</span>
        ) : (
          <span className={styles.anchor} title={market.anchor.description}>
            <strong>{anchorValue}</strong>
            <time dateTime={market.anchor.date}>{formatDate(market.anchor.date)}</time>
            <span className={styles.visuallyHidden}>{market.anchor.description}</span>
          </span>
        )}
      </td>
      <td className={styles.claimsCell} data-label="Claims">
        <span className={styles.tabular}>
          {compactNumberFormatter.format(market.outstandingClaims)}
        </span>
      </td>
      <td className={styles.statusCell} data-label="Status">
        <span className={styles.statusGroup}>
          {market.status === "open" ? (
            <Link className={styles.tradeLink} href={`/m/${market.company.slug}`}>
              Trade ›
            </Link>
          ) : (
            <span className={styles.statusSettled}>Settled</span>
          )}
          {market.settledAt === null ? null : (
            <time className={styles.settledDate} dateTime={market.settledAt}>
              {formatDate(market.settledAt)}
            </time>
          )}
        </span>
      </td>
    </tr>
  );
}

function MarketRowGroup({
  market,
  expanded,
  onToggle,
}: {
  readonly market: MarketListItem;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <>
      <MarketRow market={market} expanded={expanded} onToggle={onToggle} />
      {expanded ? (
        <tr className={styles.ladderRow}>
          <td colSpan={8}>
            <InlineLadder market={market} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function MarketBoardSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" aria-label="Loading markets">
      <div className={styles.skeletonHeader} />
      {[0, 1].map((row) => (
        <div className={styles.skeletonRow} key={row}>
          <span className={styles.skeletonLogo} />
          <span className={styles.skeletonName} />
          <span className={styles.skeletonMetric} />
          <span className={styles.skeletonChart} />
        </div>
      ))}
    </div>
  );
}

export function MarketBoard({
  initialData,
}: {
  readonly initialData?: MarketListResult | undefined;
}) {
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const initialQueryData =
    initialData === undefined
      ? {}
      : {
          initialData,
          initialDataUpdatedAt: Date.parse(initialData.asOf),
        };
  const marketsQuery = useQuery({
    queryKey: queryKeys.markets,
    queryFn: () => apiRequest<MarketListResult>("/api/markets"),
    refetchInterval: POLL_INTERVAL_MS,
    ...initialQueryData,
  });

  if (marketsQuery.isPending) {
    return <MarketBoardSkeleton />;
  }

  if (marketsQuery.isError) {
    return (
      <div className={styles.state} role="alert">
        <div>
          <strong>Market data is unavailable.</strong>
          <p>OpenMarket could not refresh the board. Existing prices have not been replaced.</p>
        </div>
        <button className={styles.retry} type="button" onClick={() => void marketsQuery.refetch()}>
          Retry market data
        </button>
      </div>
    );
  }

  if (marketsQuery.data.markets.length === 0) {
    return (
      <div className={styles.state}>
        <div>
          <strong>No markets are published.</strong>
          <p>Verified markets will appear here after they are opened by an administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tableViewport}>
      <table className={styles.table}>
        <caption className={styles.visuallyHidden}>
          Public markets with current metric, 24-hour movement, history, anchor, claims, and status
        </caption>
        <thead>
          <tr>
            <th scope="col" className={styles.expandHeader}>
              <span className={styles.visuallyHidden}>Probability ladder</span>
            </th>
            <th scope="col">Market</th>
            <th scope="col">Current</th>
            <th scope="col">24h</th>
            <th scope="col">History</th>
            <th scope="col">Public anchor</th>
            <th scope="col">Claims</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {marketsQuery.data.markets.map((market) => {
            const expanded = expandedSlug === market.company.slug;
            return (
              <MarketRowGroup
                key={market.marketId}
                market={market}
                expanded={expanded}
                onToggle={() => setExpandedSlug(expanded ? null : market.company.slug)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
