"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { SyntheticEvent } from "react";

import { apiRequest } from "../../lib/client/api.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type {
  MarketListHistoryPoint,
  MarketListItem,
  MarketListResult,
} from "../../lib/services/list-markets.js";
import styles from "./market-board.module.css";

const POLL_INTERVAL_MS = 4_000;
const SPARKLINE_WIDTH = 120;
const SPARKLINE_HEIGHT = 32;
const SPARKLINE_PADDING = 2;

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
function hideBrokenLogo(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true;
}

function formatUsd(value: number): string {
  return `$${compactNumberFormatter.format(value)}`;
}

function formatMetric(market: MarketListItem, value = market.metric.current): string {
  return market.metric.format === "usd"
    ? formatUsd(value)
    : `${(value * 100).toFixed(1)}%`;
}

function formatChange(market: MarketListItem): {
  readonly icon: string;
  readonly direction: "up" | "down" | "flat";
  readonly label: string;
} {
  const change = market.metric.change24Hours;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const icon = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
  const amount =
    market.metric.format === "usd"
      ? formatUsd(Math.abs(change))
      : `${(Math.abs(change) * 100).toFixed(1)} pts`;

  return {
    icon,
    direction,
    label:
      direction === "flat"
        ? `Flat ${amount}`
        : `${direction === "up" ? "Up" : "Down"} ${amount}`,
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

  const first = market.history[0];
  const last = market.history.at(-1);
  const summary =
    first === undefined || last === undefined
      ? "No history"
      : `${market.metric.label} moved from ${formatMetric(market, first.value)} to ${formatMetric(market, last.value)} across ${market.history.length} observations.`;

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

function MarketRow({ market }: { readonly market: MarketListItem }) {
  const movement = formatChange(market);
  const anchorValue =
    market.anchor === null ? null : formatUsd(Number(market.anchor.valuationUsd));

  return (
    <tr className={styles.marketRow}>
      <th className={styles.identityCell} scope="row">
        <div className={styles.identity}>
          <span className={styles.logoFrame} aria-hidden="true">
            <span className={styles.logoFallback}>
              {market.company.name.slice(0, 2).toUpperCase()}
            </span>
            <img
              className={styles.logo}
              src={market.company.logoPath}
              alt=""
              width="32"
              height="32"
              onError={hideBrokenLogo}
            />
          </span>
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
          <span aria-hidden="true">{movement.icon}</span> {movement.label}
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
            <time dateTime={market.anchor.date}>
              {dateFormatter.format(new Date(market.anchor.date))}
            </time>
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
          <span
            className={
              market.status === "open" ? styles.statusOpen : styles.statusSettled
            }
          >
            {market.status === "open" ? "Open" : "Settled"}
          </span>
          {market.settledAt === null ? null : (
            <time className={styles.settledDate} dateTime={market.settledAt}>
              {dateFormatter.format(new Date(market.settledAt))}
            </time>
          )}
        </span>
      </td>
    </tr>
  );
}

function MarketBoardSkeleton() {
  return (
    <div
      className={styles.skeleton}
      role="status"
      aria-busy="true"
      aria-label="Loading markets"
    >
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
        <button
          className={styles.retry}
          type="button"
          onClick={() => void marketsQuery.refetch()}
        >
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
          Public markets with current metric, 24-hour movement, history, anchor, claims,
          and status
        </caption>
        <thead>
          <tr>
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
          {marketsQuery.data.markets.map((market) => (
            <MarketRow key={market.marketId} market={market} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
