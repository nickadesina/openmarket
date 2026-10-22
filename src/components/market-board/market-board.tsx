"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiRequest, POLL_INTERVAL_MS } from "../../lib/client/api.js";
import {
  formatCompactUsd,
  formatDate,
  formatPrice,
  formatProbability,
  roundChange,
  tierLabel,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { ListingView } from "../../lib/services/get-market.js";
import type { MarketListResult } from "../../lib/services/list-markets.js";
import { CompanyLogo } from "../company-logo/company-logo.js";
import { MovementArrow } from "../icons/icons.js";
import { DemoBanner } from "../market-demo/market-demo.js";
import styles from "./market-board.module.css";

function ListingRow({ listing }: { readonly listing: ListingView }) {
  const { forward, binary } = listing;
  const round = roundChange(listing.vsLastRound);
  const href = `/m/${listing.company.slug}`;

  return (
    <tr className={styles.marketRow}>
      <th className={styles.identityCell} scope="row">
        <div className={styles.identity}>
          <CompanyLogo name={listing.company.name} logoPath={listing.company.logoPath} size="lg" />
          <span>
            <Link className={styles.marketLink} href={href}>
              {listing.company.name}
            </Link>
            <span className={styles.metricLabel}>{tierLabel(listing.tier)}</span>
          </span>
        </div>
      </th>
      <td className={styles.metricCell} data-label="Forward mid">
        {forward === null ? (
          <span className={styles.unavailable}>Not trading</span>
        ) : (
          <strong className={styles.metricValue}>{formatPrice(forward.mid_usd)}</strong>
        )}
      </td>
      <td className={styles.quoteCell} data-label="Bid / ask">
        {forward === null ? (
          <span className={styles.unavailable}>—</span>
        ) : (
          <span className={styles.twoWay}>
            {formatPrice(forward.bid_usd)} <span aria-hidden="true">/</span>
            <span className={styles.visuallyHidden}>to</span> {formatPrice(forward.ask_usd)}
          </span>
        )}
      </td>
      <td className={styles.changeCell} data-label="Vs last round">
        <span className={styles[round.direction]}>
          <MovementArrow direction={round.direction} /> {round.label}
        </span>
      </td>
      <td className={styles.binaryCell} data-label="Binary YES">
        {binary === null ? (
          <span className={styles.unavailable}>Not trading</span>
        ) : (
          <span className={styles.binary}>
            <strong>{formatProbability(binary.yes_price)}</strong>
            <time dateTime={binary.expires_at}>
              {listing.binaryEvent === "public_s1" ? "S-1" : "Round"} by{" "}
              {formatDate(binary.expires_at)}
            </time>
          </span>
        )}
      </td>
      <td className={styles.openInterestCell} data-label="Open interest">
        <span className={styles.tabular}>{formatCompactUsd(listing.openInterest.totalUsd)}</span>
      </td>
      <td className={styles.statusCell}>
        <Link className={styles.tradeLink} href={href}>
          Trade ›
        </Link>
      </td>
    </tr>
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

/** One row per listed name: the forward's mid and two-way quote, the binary's YES, open interest. */
export function MarketBoard({
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

  if (marketsQuery.isPending) {
    return <MarketBoardSkeleton />;
  }

  if (marketsQuery.isError && marketsQuery.data === undefined) {
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

  if (marketsQuery.data!.listings.length === 0) {
    return (
      <div className={styles.state}>
        <div>
          <strong>No names are listed.</strong>
          <p>
            Listed names appear here once an operator lists them and the dealer job quotes their two
            contracts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.board}>
      <DemoBanner />
      {marketsQuery.isError ? (
        <p role="status">Unable to refresh. Showing the latest confirmed prices.</p>
      ) : null}
      <div className={styles.tableViewport}>
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>
            Listed names with the forward&apos;s mid and two-way quote, the level against the last
            round, the quarterly binary&apos;s YES price, and open interest
          </caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Forward mid</th>
              <th scope="col">Bid / ask</th>
              <th scope="col">Vs last round</th>
              <th scope="col">Binary YES</th>
              <th scope="col">Open interest</th>
              <th scope="col">
                <span className={styles.visuallyHidden}>Trade</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {marketsQuery.data!.listings.map((listing) => (
              <ListingRow key={listing.listingId} listing={listing} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
