"use client";

import {
  formatCents,
  formatDate,
  formatDateTime,
  formatForwardNotional,
  formatPrice,
  formatProbability,
  formatQuantityShort,
  formatValuation,
  formatVersion,
  sideLabel,
} from "../../lib/client/format.js";
import { DemoTag } from "../market-demo/market-demo.js";
import type { ActivityItem, ActivityPage, ListingDetail } from "../market-workspace/types.js";
import styles from "./market-activity.module.css";

interface MarketActivityProps {
  readonly listing: ListingDetail;
  readonly activity: ActivityPage | undefined;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
}

/** One fill as the tape reads it: a forward's notional at its entry, or a binary's shares. */
function ActivityRow({ item }: { readonly item: ActivityItem }) {
  const forward = item.metricKind === "forward_ln";
  return (
    <li>
      <div>
        <strong>
          {forward
            ? `${sideLabel(item.side)} ${formatForwardNotional(item.quantity)} forward${item.entryUsd === null ? "" : ` at ${formatPrice(item.entryUsd)}`}`
            : `${item.action === "buy" ? "Bought" : "Sold"} ${formatQuantityShort(item.quantity)} ${sideLabel(item.side)}`}
        </strong>
        <span className={styles.meta}>
          <span suppressHydrationWarning>{formatDateTime(item.createdAt)}</span>
          {item.demo ? <DemoTag /> : null}
        </span>
      </div>
      <div className={styles.tradeValues}>
        <strong>{formatCents(item.cashAmountCents)}</strong>
        <span>
          {forward
            ? "collateral"
            : `${item.action === "buy" ? "cost" : "proceeds"} · YES ${formatProbability(item.metricAfter)} after`}
        </span>
      </div>
    </li>
  );
}

export function MarketActivity({
  listing,
  activity,
  loading,
  error,
  onRetry,
}: MarketActivityProps) {
  const settled = listing.epochs.filter((epoch) => epoch.marketStatus === "settled");
  return (
    <div className={styles.lowerGrid}>
      <section className={styles.activity} aria-labelledby="activity-title" aria-busy={loading}>
        <header>
          <div>
            <h2 id="activity-title" className={styles.tab}>
              Market activity
            </h2>
            <p>Fills on both contracts, newest first</p>
          </div>
          {loading && activity !== undefined ? (
            <span className={styles.refreshing}>Refreshing</span>
          ) : error && activity !== undefined ? (
            <button type="button" className={styles.refreshButton} onClick={onRetry}>
              Refresh paused. Retry
            </button>
          ) : null}
        </header>
        {error && activity === undefined ? (
          <div className={styles.message} role="alert">
            <p>Activity could not be loaded.</p>
            <button type="button" onClick={onRetry}>
              Retry activity
            </button>
          </div>
        ) : null}
        {loading && activity === undefined ? (
          <div
            className={styles.skeleton}
            role="status"
            aria-busy="true"
            aria-label="Loading market activity"
          >
            <span />
            <span />
            <span />
          </div>
        ) : null}
        {activity?.items.length === 0 ? (
          <div className={styles.message}>
            <strong>No trades yet</strong>
            <p>Price a forward or a binary in the trade ticket to place the first one.</p>
          </div>
        ) : null}
        {activity !== undefined && activity.items.length > 0 ? (
          <ol className={styles.list}>
            {activity.items.map((item) => (
              <ActivityRow key={`${item.marketId}-${item.marketSequence}`} item={item} />
            ))}
          </ol>
        ) : null}
      </section>

      <section className={styles.resolution} aria-labelledby="resolution-title">
        <h2 id="resolution-title" className={styles.tab}>
          Resolution
        </h2>
        <p>
          The forward settles on the first qualifying post-money after it opens, dated by{" "}
          {listing.forward === null ? "its expiry" : formatDate(listing.forward.expires_at)}: a long
          is paid notional × (ln print − ln entry), clipped at ±κ. With no print by then it voids
          and refunds the collateral. The binary pays $1 a YES share if{" "}
          {listing.binaryEvent === "public_s1"
            ? "a public S-1 is filed"
            : "a priced round is announced"}{" "}
          by {listing.binary === null ? "quarter-end" : formatDate(listing.binary.expires_at)}.
          Positions are held to settlement or void; there is no early close.
        </p>
        <dl>
          <div>
            <dt>Last print</dt>
            <dd>
              {formatValuation(listing.anchor.postMoneyUsd)} · {listing.anchor.round}
            </dd>
          </div>
          <div>
            <dt>As of</dt>
            <dd>{formatDate(listing.anchor.date)}</dd>
          </div>
          {settled.length > 0 ? (
            <div>
              <dt>Settled epochs</dt>
              <dd>{settled.length}</dd>
            </div>
          ) : null}
        </dl>
        <a href="/api/ref/rulebook" target="_blank" rel="noreferrer">
          Rulebook {formatVersion(listing.rulebookVersion)}
        </a>{" "}
        ·{" "}
        <a href={listing.anchor.sourceUrl} target="_blank" rel="noreferrer">
          Last print source
        </a>
      </section>
    </div>
  );
}
