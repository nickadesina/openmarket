"use client";

import { useQuery } from "@tanstack/react-query";

import { apiRequest, POLL_INTERVAL_MS } from "../../lib/client/api.js";
import { formatCents } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { MarketListResult } from "../../lib/services/list-markets.js";
import styles from "./home-stats.module.css";

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const clockFormatter = new Intl.DateTimeFormat("en-US", { timeStyle: "medium" });

/** Hairline strip of live facts under the top bar: only figures the API actually reports. */
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
  const claims = open.reduce((total, market) => total + market.outstandingClaims, 0);
  const asOf = marketsQuery.data?.asOf;

  return (
    <div className={styles.strip}>
      <h1 className={styles.title}>Valuation markets</h1>
      <dl className={styles.facts}>
        {identityQuery.data === undefined ? null : (
          <div>
            <dt>Paper cash</dt>
            <dd className={styles.cash}>{formatCents(identityQuery.data.cashBalanceCents)}</dd>
          </div>
        )}
        <div>
          <dt>Markets</dt>
          <dd>
            {marketsUnavailable
              ? "Unavailable"
              : `${open.length} open${markets.length > open.length ? ` · ${markets.length - open.length} settled` : ""}`}
          </dd>
        </div>
        <div>
          <dt>Claims outstanding</dt>
          <dd>{marketsUnavailable ? "Unavailable" : compactFormatter.format(claims)}</dd>
        </div>
        <div>
          <dt>Last update</dt>
          <dd>
            {/* ICU output differs between Node and the browser; the client value wins. */}
            <time dateTime={asOf} suppressHydrationWarning>
              {asOf === undefined ? "—" : clockFormatter.format(new Date(asOf))}
            </time>
            <span className={styles.note}>Refresh every {POLL_INTERVAL_MS / 1000}s</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
