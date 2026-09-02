"use client";

import { useQueries, useQuery } from "@tanstack/react-query";

import { apiRequest, POLL_INTERVAL_MS } from "../../lib/client/api.js";
import { formatProbability, formatValuation } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { MarketDetail } from "../../lib/services/get-market.js";
import type { MarketListItem, MarketListResult } from "../../lib/services/list-markets.js";
import { CompanyLogo } from "../company-logo/company-logo.js";
import styles from "./home-distribution.module.css";

// Band edges are the market's own 10th and 90th percentiles; the axis is the
// band with half a decade of room on each side, widened to admit the round.
const LOWER_QUANTILE = 0.1;
const UPPER_QUANTILE = 0.9;
const AXIS_MARGIN = Math.sqrt(10);

interface Band {
  readonly axisMin: number;
  readonly axisMax: number;
  readonly lower: number;
  readonly upper: number;
  readonly median: number;
  readonly anchor: number | null;
  readonly mode: { readonly from: number | null; readonly to: number | null; readonly mass: number };
}

/** Valuation at which the YES probability falls to `yesTarget`, log-interpolated between strikes. */
function valuationAtYes(contracts: MarketDetail["contracts"], yesTarget: number): number | null {
  const first = contracts[0];
  const last = contracts[contracts.length - 1];
  // Beyond the ladder's ends the quantile is pinned to the edge strike.
  if (first?.strikeValueUsd != null && first.yesProbability < yesTarget) return Number(first.strikeValueUsd);
  if (last?.strikeValueUsd != null && last.yesProbability > yesTarget) return Number(last.strikeValueUsd);
  for (let index = 1; index < contracts.length; index += 1) {
    const above = contracts[index - 1]!;
    const below = contracts[index]!;
    if (above.strikeValueUsd === null || below.strikeValueUsd === null) continue;
    if (above.yesProbability >= yesTarget && below.yesProbability <= yesTarget) {
      const span = above.yesProbability - below.yesProbability;
      const t = span === 0 ? 0 : (above.yesProbability - yesTarget) / span;
      const low = Math.log(Number(above.strikeValueUsd));
      const high = Math.log(Number(below.strikeValueUsd));
      return Math.exp(low + (high - low) * t);
    }
  }
  return null;
}

function computeBand(market: MarketDetail): Band | null {
  if (market.metric.kind !== "valuation_median" || market.contracts.length < 2) return null;
  const lower = valuationAtYes(market.contracts, 1 - LOWER_QUANTILE);
  const upper = valuationAtYes(market.contracts, 1 - UPPER_QUANTILE);
  if (lower === null || upper === null || lower <= 0 || upper <= lower) return null;
  const anchorValue = market.anchor === null ? null : Number(market.anchor.valuationUsd);
  const axisMin = Math.min(lower / AXIS_MARGIN, anchorValue ?? Number.POSITIVE_INFINITY, market.metric.current) / 1.05;
  const axisMax = Math.max(upper * AXIS_MARGIN, anchorValue ?? 0, market.metric.current) * 1.05;

  let modeIndex = 0;
  market.pmf.forEach((mass, index) => {
    if (mass > (market.pmf[modeIndex] ?? 0)) modeIndex = index;
  });
  const from = market.contracts[modeIndex - 1]?.strikeValueUsd ?? null;
  const to = market.contracts[modeIndex]?.strikeValueUsd ?? null;

  return {
    axisMin,
    axisMax,
    lower,
    upper,
    median: market.metric.current,
    anchor: anchorValue,
    mode: {
      from: from === null ? null : Number(from),
      to: to === null ? null : Number(to),
      mass: market.pmf[modeIndex] ?? 0,
    },
  };
}

function position(band: Band, value: number): number {
  const low = Math.log(band.axisMin);
  const high = Math.log(band.axisMax);
  const t = (Math.log(value) - low) / (high - low);
  return Math.min(100, Math.max(0, t * 100));
}

function DistributionRow({ market, detail }: { readonly market: MarketListItem; readonly detail: MarketDetail | undefined }) {
  const band = detail === undefined ? null : computeBand(detail);
  return (
    <div className={styles.row}>
      <div className={styles.identity}>
        <CompanyLogo name={market.company.name} logoPath={market.company.logoPath} size="sm" />
        <span>{market.company.name}</span>
      </div>

      {band === null ? (
        <p className={styles.unavailable}>
          {detail === undefined ? "Loading distribution…" : "No valuation distribution for this contract."}
        </p>
      ) : (
        <>
          <div className={styles.band} role="img" aria-label={`${market.company.name}: 80% of probability between ${formatValuation(band.lower)} and ${formatValuation(band.upper)}, median ${formatValuation(band.median)}${band.anchor === null ? "" : `, last round ${formatValuation(band.anchor)}`}.`}>
            <span className={styles.track} />
            <span
              className={styles.range}
              style={{ left: `${position(band, band.lower)}%`, width: `${position(band, band.upper) - position(band, band.lower)}%` }}
            />
            <span className={styles.medianTick} style={{ left: `${position(band, band.median)}%` }}>
              <em>{formatValuation(band.median)}</em>
            </span>
            {band.anchor === null ? null : (
              <span className={styles.anchorTick} style={{ left: `${position(band, band.anchor)}%` }}>
                <em>Round {formatValuation(band.anchor)}</em>
              </span>
            )}
          </div>

          <dl className={styles.facts}>
            <div>
              <dt>80% band</dt>
              <dd>{formatValuation(band.lower)} – {formatValuation(band.upper)}</dd>
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

/** Where each market thinks the valuation lands: the 10–90 band, median, and last round on one log axis. */
export function HomeDistribution({ initialData }: { readonly initialData?: MarketListResult | undefined }) {
  const marketsQuery = useQuery({
    queryKey: queryKeys.markets,
    queryFn: () => apiRequest<MarketListResult>("/api/markets"),
    refetchInterval: POLL_INTERVAL_MS,
    ...(initialData === undefined ? {} : { initialData, initialDataUpdatedAt: Date.parse(initialData.asOf) }),
  });
  const markets = (marketsQuery.data?.markets ?? []).filter((market) => market.metric.kind === "valuation_median");
  const details = useQueries({
    queries: markets.map((market) => ({
      queryKey: queryKeys.market(market.company.slug),
      queryFn: () => apiRequest<MarketDetail>(`/api/markets/${encodeURIComponent(market.company.slug)}`),
      refetchInterval: POLL_INTERVAL_MS,
    })),
  });

  if (markets.length === 0) return null;

  return (
    <div className={styles.list}>
      {markets.map((market, index) => (
        <DistributionRow key={market.marketId} market={market} detail={details[index]?.data} />
      ))}
    </div>
  );
}
