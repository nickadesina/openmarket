"use client";

import { useQueries, useQuery } from "@tanstack/react-query";

import { apiRequest, POLL_INTERVAL_MS } from "../../lib/client/api.js";
import { formatMetric } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { MarkHistory, MarkRange } from "../../lib/services/get-marks.js";
import type { MarketListItem, MarketListResult } from "../../lib/services/list-markets.js";
import { CompanyLogo } from "../company-logo/company-logo.js";
import { MovementArrow } from "../icons/icons.js";
import styles from "./home-quote-sheet.module.css";

const RANGES = ["1h", "1d", "1w", "all"] as const satisfies readonly MarkRange[];
const RANGE_LABEL: Record<MarkRange, string> = { "1h": "1H", "1d": "1D", "1w": "1W", all: "All" };
// Window figures move slower than the tape; poll them at a fifth of the rate.
const SHEET_POLL_MS = POLL_INTERVAL_MS * 5;

interface WindowFigures {
  readonly change: number | null;
  readonly high: number | null;
  readonly low: number | null;
}

function figures(history: MarkHistory | undefined): WindowFigures {
  if (history === undefined || history.points.length === 0) return { change: null, high: null, low: null };
  const values = history.points.map((point) => point.value);
  return {
    change: history.currentMetric - history.points[0]!.value,
    high: Math.max(...values),
    low: Math.min(...values),
  };
}

function Change({ market, value }: { readonly market: MarketListItem; readonly value: number | null }) {
  if (value === null) return <span className={styles.none}>—</span>;
  const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const amount = market.metric.kind === "valuation_median"
    ? formatMetric(Math.abs(value), market.metric.kind)
    : `${(Math.abs(value) * 100).toFixed(1)} pts`;
  return (
    <span className={styles[direction]}>
      <MovementArrow direction={direction} size={10} /> {direction === "flat" ? "Flat" : amount}
    </span>
  );
}

/** A newspaper quote table: last, and per window the change, high, and low. */
export function HomeQuoteSheet({ initialData }: { readonly initialData?: MarketListResult | undefined }) {
  const marketsQuery = useQuery({
    queryKey: queryKeys.markets,
    queryFn: () => apiRequest<MarketListResult>("/api/markets"),
    refetchInterval: POLL_INTERVAL_MS,
    ...(initialData === undefined ? {} : { initialData, initialDataUpdatedAt: Date.parse(initialData.asOf) }),
  });
  const markets = marketsQuery.data?.markets ?? [];
  const histories = useQueries({
    queries: markets.flatMap((market) =>
      RANGES.map((range) => ({
        queryKey: queryKeys.marks(market.company.slug, range),
        queryFn: () => apiRequest<MarkHistory>(`/api/markets/${encodeURIComponent(market.company.slug)}/marks?range=${range}`),
        refetchInterval: SHEET_POLL_MS,
      })),
    ),
  });

  if (markets.length === 0) return null;

  return (
    <div className={styles.viewport}>
      <table className={styles.table}>
        <caption className={styles.visuallyHidden}>
          Last value with change, high, and low over the past hour, day, week, and all time
        </caption>
        <thead>
          <tr className={styles.groupRow}>
            <th scope="col" rowSpan={2} className={styles.marketHead}>Market</th>
            <th scope="col" rowSpan={2} className={styles.lastHead}>Last</th>
            <th scope="colgroup" colSpan={1}>{RANGE_LABEL["1h"]}</th>
            <th scope="colgroup" colSpan={3}>{RANGE_LABEL["1d"]}</th>
            <th scope="colgroup" colSpan={3}>{RANGE_LABEL["1w"]}</th>
            <th scope="colgroup" colSpan={2}>{RANGE_LABEL.all}</th>
          </tr>
          <tr>
            <th scope="col">Chg</th>
            <th scope="col">Chg</th>
            <th scope="col">High</th>
            <th scope="col">Low</th>
            <th scope="col">Chg</th>
            <th scope="col">High</th>
            <th scope="col">Low</th>
            <th scope="col">High</th>
            <th scope="col">Low</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market, marketIndex) => {
            const byRange = Object.fromEntries(
              RANGES.map((range, rangeIndex) => [range, figures(histories[marketIndex * RANGES.length + rangeIndex]?.data)]),
            ) as Record<MarkRange, WindowFigures>;
            const cell = (value: number | null) =>
              value === null ? <span className={styles.none}>—</span> : formatMetric(value, market.metric.kind);
            return (
              <tr key={market.marketId}>
                <th scope="row" className={styles.marketCell}>
                  <CompanyLogo name={market.company.name} logoPath={market.company.logoPath} size="sm" />
                  <span>{market.company.name}</span>
                </th>
                <td className={styles.last}>{formatMetric(market.metric.current, market.metric.kind)}</td>
                <td><Change market={market} value={byRange["1h"].change} /></td>
                <td><Change market={market} value={byRange["1d"].change} /></td>
                <td>{cell(byRange["1d"].high)}</td>
                <td>{cell(byRange["1d"].low)}</td>
                <td><Change market={market} value={byRange["1w"].change} /></td>
                <td>{cell(byRange["1w"].high)}</td>
                <td>{cell(byRange["1w"].low)}</td>
                <td>{cell(byRange.all.high)}</td>
                <td>{cell(byRange.all.low)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
