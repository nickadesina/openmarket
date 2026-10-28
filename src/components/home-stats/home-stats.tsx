"use client";

import { useQuery } from "@tanstack/react-query";

import { apiRequest, POLL_INTERVAL_MS } from "../../lib/client/api.js";
import { formatCompactUsd, formatDateTime } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { ListingView } from "../../lib/services/get-market.js";
import type { MarketListResult } from "../../lib/services/list-markets.js";
import styles from "./home-stats.module.css";

function latestTrade(listings: readonly ListingView[]): string | undefined {
  let latest: string | undefined;
  for (const listing of listings) {
    const last = listing.lastTradeAt;
    if (last !== null && (latest === undefined || last > latest)) latest = last;
  }
  return latest;
}

/**
 * Gray strip under the top bar: the facts the board below does not carry
 * (open interest across names, the last trade). Each name's level and its
 * move against the last round are the board's; paper cash is the header's.
 */
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
  const marketsUnavailable = marketsQuery.isError && marketsQuery.data === undefined;
  const listings = marketsQuery.data?.listings ?? [];
  const openInterest = listings.reduce(
    (total, listing) => total + listing.openInterest.totalUsd,
    0,
  );
  const lastTrade = latestTrade(listings);

  return (
    <div className={styles.strip}>
      <h1 className={styles.visuallyHidden}>Valuation markets</h1>
      <dl className={styles.facts}>
        <div className={styles.cell}>
          <dt className={styles.label}>Open interest</dt>
          <dd>{marketsUnavailable ? "Unavailable" : formatCompactUsd(openInterest)}</dd>
        </div>
        <div className={styles.cell}>
          <dt className={styles.label}>Last trade</dt>
          <dd>
            {/* ICU output differs between Node and the browser; the client value wins. */}
            <time dateTime={lastTrade} suppressHydrationWarning>
              {lastTrade === undefined ? "None yet" : formatDateTime(lastTrade)}
            </time>
          </dd>
        </div>
      </dl>
      <p className={styles.note}>
        {marketsQuery.isError
          ? "Refresh paused; showing confirmed levels."
          : `Refreshes every ${POLL_INTERVAL_MS / 1000}s`}
      </p>
    </div>
  );
}
