"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { SyntheticEvent } from "react";

import { apiRequest } from "../../lib/client/api.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { ActivityItem, ActivityPage } from "../../lib/services/get-activity.js";
import styles from "./home-activity.module.css";

const POLL_INTERVAL_MS = 4_000;
const ACTIVITY_LIMIT = 12;

const quantityFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
});
const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const valuationFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
  timeZoneName: "short",
});

function hideBrokenLogo(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true;
}

function contractLabel(item: ActivityItem): string {
  const side = item.side.toUpperCase();
  if (item.strikeValueUsd === null) {
    return side;
  }

  const strike = valuationFormatter.format(Number(item.strikeValueUsd));
  return item.side === "yes" ? `${side} above ${strike}` : `${side} at or below ${strike}`;
}

function ActivityRow({ item }: { readonly item: ActivityItem }) {
  const action = item.action === "buy" ? "Bought" : "Sold";
  const cash = moneyFormatter.format(Math.abs(Number(item.cashAmountCents)) / 100);

  return (
    <li className={styles.item}>
      <span className={styles.logoFrame} aria-hidden="true">
        <span className={styles.logoFallback}>
          {item.company.name.slice(0, 2).toUpperCase()}
        </span>
        <img
          className={styles.logo}
          src={item.company.logoPath}
          alt=""
          width="28"
          height="28"
          onError={hideBrokenLogo}
        />
      </span>
      <div className={styles.event}>
        <p>
          <span className={item.action === "buy" ? styles.buy : styles.sell}>{action}</span>{" "}
          <strong>{quantityFormatter.format(item.quantity)}</strong>{" "}
          <span className={styles.muted}>shares of</span>{" "}
          <strong>{contractLabel(item)}</strong>
        </p>
        <p className={styles.meta}>
          <Link href={`/m/${item.company.slug}`}>{item.company.name}</Link>
          <span aria-hidden="true">·</span>
          <span>{cash}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.createdAt}>
            {timestampFormatter.format(new Date(item.createdAt))}
          </time>
        </p>
      </div>
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

export function HomeActivity({
  initialData,
}: {
  readonly initialData?: ActivityPage | undefined;
}) {
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
        <ActivityRow
          key={`${item.company.slug}-${item.marketSequence}`}
          item={item}
        />
      ))}
    </ol>
  );
}
