"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiRequest, POLL_INTERVAL_MS } from "../../lib/client/api.js";
import {
  formatCents,
  formatCompactUsd,
  formatDateTime,
  formatPrice,
  roundChange,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { MarketListItem, MarketListResult } from "../../lib/services/list-markets.js";
import { CompanyLogo } from "../company-logo/company-logo.js";
import { MovementArrow } from "../icons/icons.js";
import styles from "./home-stats.module.css";

function latestTrade(markets: readonly MarketListItem[]): string | undefined {
  let latest: string | undefined;
  for (const market of markets) {
    const last = market.history.at(-1)?.timestamp;
    if (last !== undefined && (latest === undefined || last > latest)) latest = last;
  }
  return latest;
}

function IndexCell({ market }: { readonly market: MarketListItem }) {
  const movement = roundChange(market.metric.current, market.anchor?.valuationUsd ?? Number.NaN);
  return (
    <li className={styles.cell}>
      <CompanyLogo name={market.company.name} logoPath={market.company.logoPath} size="sm" />
      <Link className={styles.name} href={`/m/${market.company.slug}`}>
        {market.company.name}
      </Link>
      <strong className={styles.level}>{formatPrice(market.metric.current)}</strong>
      <span className={styles[movement.direction]}>
        <MovementArrow direction={movement.direction} /> {movement.label} vs last round
      </span>
    </li>
  );
}

/** Gray index strip under the top bar: each open market's level, then the live facts. */
export function HomeStats({
  initialData,
}: {
  readonly initialData?: MarketListResult | undefined;
}) {
  const marketsQuery = useQuery({
    queryKey: queryKeys.markets,
    queryFn: () => apiRequest<MarketListResult>("/api/markets"),
    refetchInterval: POLL_INTERVAL_MS,
    ...(initialData === undefined
      ? {}
      : { initialData, initialDataUpdatedAt: Date.parse(initialData.asOf) }),
  });
  const identityQuery = useQuery({
    queryKey: queryKeys.portfolio,
    queryFn: () =>
      apiRequest<{ readonly cashBalanceCents: string }>("/api/portfolio?offset=0&limit=1"),
  });

  const marketsUnavailable = marketsQuery.isError && marketsQuery.data === undefined;
  const markets = marketsQuery.data?.markets ?? [];
  const open = markets.filter((market) => market.status === "open");
  const indexed = open.filter(
    (market) => market.metric.kind === "valuation_median" && market.anchor !== null,
  );
  const openInterest = open.reduce((total, market) => total + market.openInterest, 0);
  const lastTrade = latestTrade(markets);

  return (
    <div className={styles.strip}>
      <h1 className={styles.visuallyHidden}>Valuation markets</h1>
      {marketsUnavailable ? (
        <p className={styles.cell}>Market levels are unavailable.</p>
      ) : (
        <ul className={styles.index} aria-label="Market levels">
          {indexed.map((market) => (
            <IndexCell key={market.marketId} market={market} />
          ))}
        </ul>
      )}
      <dl className={styles.facts}>
        {identityQuery.data == null ? null : (
          <div className={styles.cell}>
            <dt>Paper cash</dt>
            <dd className={styles.cash}>{formatCents(identityQuery.data.cashBalanceCents)}</dd>
          </div>
        )}
        <div className={styles.cell}>
          <dt>Open interest</dt>
          <dd>{marketsUnavailable ? "Unavailable" : formatCompactUsd(openInterest)}</dd>
        </div>
        <div className={styles.cell}>
          <dt>Last trade</dt>
          <dd>
            {/* ICU output differs between Node and the browser; the client value wins. */}
            <time dateTime={lastTrade} suppressHydrationWarning>
              {lastTrade === undefined ? "None yet" : formatDateTime(lastTrade)}
            </time>
          </dd>
        </div>
      </dl>
      <p className={styles.note}>Refreshes every {POLL_INTERVAL_MS / 1000}s</p>
    </div>
  );
}
