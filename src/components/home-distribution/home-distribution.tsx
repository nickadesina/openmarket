"use client";

import { useQuery } from "@tanstack/react-query";

import { apiRequest, POLL_INTERVAL_MS } from "../../lib/client/api.js";
import { formatPrice, formatProbability, formatValuation } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { ListingView } from "../../lib/services/get-market.js";
import type { MarketListResult } from "../../lib/services/list-markets.js";
import { CompanyLogo } from "../company-logo/company-logo.js";
import styles from "./home-distribution.module.css";

// Band edges are the API's 10th and 90th percentiles of the implied
// distribution; the axis is the band with half a decade of room on each
// side, widened to admit the round.
const AXIS_MARGIN = Math.sqrt(10);

interface Band {
  readonly axisMin: number;
  readonly axisMax: number;
  readonly lower: number;
  readonly upper: number;
  readonly median: number;
  readonly anchor: number | null;
  readonly mode: {
    readonly from: number | null;
    readonly to: number | null;
    readonly mass: number;
  };
}

function computeBand(listing: ListingView): Band | null {
  const distribution = listing.distribution;
  if (distribution === null) return null;
  const { p10: lower, p50: median, p90: upper } = distribution.band;
  if (!(upper > lower)) return null;
  const anchorValue = Number(listing.anchor.postMoneyUsd);
  const anchor = Number.isFinite(anchorValue) && anchorValue > 0 ? anchorValue : null;
  const axisMin = Math.min(lower / AXIS_MARGIN, anchor ?? Number.POSITIVE_INFINITY) / 1.05;
  const axisMax = Math.max(upper * AXIS_MARGIN, anchor ?? 0) * 1.05;
  return {
    axisMin,
    axisMax,
    lower,
    upper,
    median,
    anchor,
    mode: {
      from: distribution.mode.fromUsd === null ? null : Number(distribution.mode.fromUsd),
      to: distribution.mode.toUsd === null ? null : Number(distribution.mode.toUsd),
      mass: distribution.mode.mass,
    },
  };
}

function position(band: Band, value: number): number {
  const low = Math.log(band.axisMin);
  const high = Math.log(band.axisMax);
  const t = (Math.log(value) - low) / (high - low);
  return Math.min(100, Math.max(0, t * 100));
}

function DistributionRow({ listing }: { readonly listing: ListingView }) {
  const market = listing;
  const band = computeBand(listing);
  return (
    <div className={styles.row}>
      <div className={styles.identity}>
        <CompanyLogo name={market.company.name} logoPath={market.company.logoPath} size="sm" />
        <span>{market.company.name}</span>
      </div>

      {band === null ? (
        <p className={styles.unavailable}>
          No live forward: the implied distribution returns when the next one lists.
        </p>
      ) : (
        <>
          <div
            className={styles.band}
            role="img"
            aria-label={`${market.company.name}: 80% of probability between ${formatPrice(band.lower)} and ${formatPrice(band.upper)}, median ${formatPrice(band.median)}${band.anchor === null ? "" : `, last round ${formatValuation(band.anchor)}`}.`}
          >
            <span className={styles.track} />
            <span
              className={styles.box}
              style={{
                left: `${position(band, band.lower)}%`,
                width: `${position(band, band.upper) - position(band, band.lower)}%`,
              }}
            />
            <span
              className={styles.medianLine}
              style={{ left: `${position(band, band.median)}%` }}
            />
            <span
              className={styles.medianLabel}
              style={{ left: `${position(band, band.median)}%` }}
            >
              <small>Median</small>
              {formatPrice(band.median)}
            </span>
            <span className={styles.edgeLabel} style={{ left: `${position(band, band.lower)}%` }}>
              <small>P10</small>
              {formatPrice(band.lower)}
            </span>
            <span
              className={`${styles.edgeLabel} ${styles.edgeLabelEnd}`}
              style={{ left: `${position(band, band.upper)}%` }}
            >
              {formatPrice(band.upper)}
              <small>P90</small>
            </span>
            {band.anchor === null ? null : (
              <>
                <span
                  className={styles.anchorMarker}
                  style={{ left: `${position(band, band.anchor)}%` }}
                />
                <span
                  className={styles.anchorLabel}
                  style={{ left: `${position(band, band.anchor)}%` }}
                >
                  <small>Round</small>
                  {formatValuation(band.anchor)}
                </span>
              </>
            )}
          </div>

          <dl className={styles.facts}>
            <div>
              <dt>80% band</dt>
              <dd>
                {formatPrice(band.lower)} – {formatPrice(band.upper)}
              </dd>
            </div>
            <div>
              <dt>Most likely</dt>
              <dd>
                {band.mode.from === null
                  ? `Below ${formatValuation(band.mode.to ?? 0)}`
                  : band.mode.to === null
                    ? `Above ${formatValuation(band.mode.from)}`
                    : `${formatValuation(band.mode.from)} – ${formatValuation(band.mode.to)}`}
                <small>{formatProbability(band.mode.mass)}</small>
              </dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}

/** Where each forward puts the next print: the implied 10–90 band, median, and last round on one log axis. */
export function HomeDistribution({
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
  const listings = marketsQuery.data?.listings ?? [];

  if (marketsQuery.isPending)
    return (
      <div
        className={styles.list}
        role="status"
        aria-label="Loading distributions"
        aria-busy="true"
      >
        {[0, 1, 2, 3, 4].map((row) => (
          <div className={styles.row} key={row}>
            <span className={styles.skeleton} />
            <span className={styles.skeleton} />
            <span className={styles.skeleton} />
          </div>
        ))}
      </div>
    );
  if (marketsQuery.isError && marketsQuery.data === undefined)
    return (
      <div className={styles.state} role="alert">
        <strong>Distributions are unavailable.</strong>
        <p>The implied distributions could not be loaded.</p>
        <button type="button" className={styles.retry} onClick={() => void marketsQuery.refetch()}>
          Retry distributions
        </button>
      </div>
    );
  if (listings.length === 0)
    return (
      <div className={styles.state}>
        <strong>No names are listed.</strong>
        <p>Implied distributions appear when a live forward lists.</p>
      </div>
    );

  return (
    <div className={styles.list}>
      {marketsQuery.isError ? (
        <p className={styles.state} role="status">
          Unable to refresh. Showing the latest confirmed distributions.
        </p>
      ) : null}
      {listings.map((listing) => (
        <DistributionRow key={listing.listingId} listing={listing} />
      ))}
    </div>
  );
}
