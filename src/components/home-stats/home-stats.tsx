"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiRequest, POLL_INTERVAL_MS, requestPortfolioIdentity } from "../../lib/client/api.js";
import {
  formatCents,
  formatCompactUsd,
  formatDateTime,
  formatPrice,
  roundChange,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { ListingView } from "../../lib/services/get-market.js";
import type { MarketListResult } from "../../lib/services/list-markets.js";
import { CompanyLogo } from "../company-logo/company-logo.js";
import { MovementArrow } from "../icons/icons.js";
import styles from "./home-stats.module.css";

function latestTrade(listings: readonly ListingView[]): string | undefined {
  let latest: string | undefined;
  for (const listing of listings) {
    const last = listing.lastTradeAt;
    if (last !== null && (latest === undefined || last > latest)) latest = last;
  }
  return latest;
}

function IndexCell({
  listing,
  midUsd,
}: {
  readonly listing: ListingView;
  readonly midUsd: number;
}) {
  const movement = roundChange(listing.vsLastRound);
  return (
    <li className={styles.cell}>
      <CompanyLogo name={listing.company.name} logoPath={listing.company.logoPath} size="sm" />
      <Link className={styles.name} href={`/m/${listing.company.slug}`}>
        {listing.company.name}
      </Link>
      <strong className={styles.level}>{formatPrice(midUsd)}</strong>
      <span className={styles[movement.direction]}>
        <MovementArrow direction={movement.direction} /> {movement.label} vs last round
      </span>
    </li>
  );
}

/** Gray index strip under the top bar: each listed name's forward mid, then the live facts. */
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
    queryKey: queryKeys.identity,
    queryFn: requestPortfolioIdentity,
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
      {marketsUnavailable ? (
        <p className={styles.cell}>Market levels are unavailable.</p>
      ) : (
        <ul className={styles.index} aria-label="Market levels">
          {listings.map((listing) =>
            listing.forward === null ? null : (
              <IndexCell
                key={listing.listingId}
                listing={listing}
                midUsd={listing.forward.mid_usd}
              />
            ),
          )}
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
      <p className={styles.note}>
        {marketsQuery.isError
          ? "Refresh paused; showing confirmed levels."
          : `Refreshes every ${POLL_INTERVAL_MS / 1000}s`}
      </p>
    </div>
  );
}
