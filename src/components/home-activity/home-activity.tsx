"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiRequest, POLL_INTERVAL_MS } from "../../lib/client/api.js";
import {
  formatCents,
  formatDateTime,
  formatPrice,
  formatQuantityShort,
  formatUsd,
  sideLabel,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { ActivityItem, ActivityPage } from "../../lib/services/get-activity.js";
import { CompanyLogo } from "../company-logo/company-logo.js";
import styles from "./home-activity.module.css";

const ACTIVITY_LIMIT = 12;

/** A forward fill reads as its side, notional and entry; a binary fill as shares bought or sold. */
function ActivityRow({ item }: { readonly item: ActivityItem }) {
  const forward = item.metricKind === "forward_ln";
  const cash = forward
    ? formatCents(item.cashAmountCents)
    : formatUsd((item.action === "buy" ? -1 : 1) * (Number(item.cashAmountCents) / 100));

  return (
    <li className={styles.item}>
      <CompanyLogo name={item.company.name} logoPath={item.company.logoPath} size="sm" />
      <div className={styles.event}>
        {forward ? (
          <p>
            <span className={styles.buy}>{sideLabel(item.side)}</span>{" "}
            <strong>{formatCents(String(Math.round(item.quantity * 100)))}</strong>{" "}
            <span className={styles.muted}>forward at</span>{" "}
            <strong>{item.entryUsd === null ? "—" : formatPrice(item.entryUsd)}</strong>
          </p>
        ) : (
          <p>
            <span className={item.action === "buy" ? styles.buy : styles.sell}>
              {item.action === "buy" ? "Bought" : "Sold"}
            </span>{" "}
            <strong>{formatQuantityShort(item.quantity)}</strong>{" "}
            <span className={styles.muted}>shares of</span> <strong>{sideLabel(item.side)}</strong>
          </p>
        )}
        <p className={styles.meta}>
          <Link href={`/m/${item.company.slug}`}>{item.company.name}</Link>
          <span aria-hidden="true">·</span>
          {/* ICU versions differ between the Node SSR and the browser (", " vs " at "); the client value wins. */}
          <time dateTime={item.createdAt} suppressHydrationWarning>
            {formatDateTime(item.createdAt)}
          </time>
        </p>
      </div>
      <span className={styles.amount}>{cash}</span>
    </li>
  );
}

function ActivitySkeleton() {
  return (
    <div
      className={styles.skeleton}
      role="status"
      aria-busy="true"
      aria-label="Loading global activity"
    >
      {[0, 1, 2, 3].map((row) => (
        <div className={styles.skeletonRow} key={row}>
          <span className={styles.skeletonLogo} />
          <span className={styles.skeletonCopy} />
        </div>
      ))}
    </div>
  );
}

export function HomeActivity({ initialData }: { readonly initialData?: ActivityPage | undefined }) {
  const initialQueryData =
    initialData === undefined
      ? {}
      : {
          initialData,
          initialDataUpdatedAt: Date.now(),
        };
  const activityQuery = useQuery({
    queryKey: queryKeys.activity(),
    queryFn: () => apiRequest<ActivityPage>(`/api/activity?limit=${ACTIVITY_LIMIT}`),
    refetchInterval: POLL_INTERVAL_MS,
    ...initialQueryData,
  });

  if (activityQuery.isPending) {
    return <ActivitySkeleton />;
  }

  if (activityQuery.isError) {
    return (
      <div className={styles.state} role="alert">
        <strong>Activity is unavailable.</strong>
        <p>Recent public trades could not be refreshed.</p>
        <button type="button" onClick={() => void activityQuery.refetch()}>
          Retry activity
        </button>
      </div>
    );
  }

  if (activityQuery.data.items.length === 0) {
    return (
      <div className={styles.state}>
        <strong>No public trades yet.</strong>
        <p>Executed orders will appear here with their market, contract, and timestamp.</p>
      </div>
    );
  }

  return (
    <ol className={styles.list} aria-label="Recent public trades">
      {activityQuery.data.items.map((item) => (
        <ActivityRow key={`${item.marketId}-${item.marketSequence}`} item={item} />
      ))}
    </ol>
  );
}
