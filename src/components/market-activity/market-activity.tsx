"use client";

import styles from "./market-activity.module.css";
import {
  formatMetric,
  formatQuantity,
  formatUsdCents,
  formatValuation,
  type ActivityPage,
  type MarketDetail,
} from "../market-workspace/types.js";

interface MarketActivityProps {
  readonly market: MarketDetail;
  readonly activity: ActivityPage | undefined;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
}

export function MarketActivity({ market, activity, loading, error, onRetry }: MarketActivityProps) {
  return (
    <div className={styles.lowerGrid}>
      <section className={styles.activity} aria-labelledby="activity-title" aria-busy={loading}>
        <header>
          <div>
            <h2 id="activity-title">Market activity</h2>
            <p>Completed trades in authoritative market sequence</p>
          </div>
          {error && activity !== undefined ? (
            <button type="button" className={styles.refreshButton} onClick={onRetry}>Refresh paused. Retry</button>
          ) : loading && activity !== undefined ? (
            <span className={styles.refreshing}>Refreshing</span>
          ) : null}
        </header>
        {error && activity === undefined ? (
          <div className={styles.message} role="alert">
            <p>Activity could not be loaded.</p>
            <button type="button" onClick={onRetry}>Retry activity</button>
          </div>
        ) : null}
        {loading && activity === undefined ? (
          <div className={styles.skeleton} aria-label="Loading market activity">
            <span /><span /><span />
          </div>
        ) : null}
        {activity?.items.length === 0 ? (
          <div className={styles.message}>
            <strong>No trades yet</strong>
            <p>Select a probability in the ladder to preview the first quote.</p>
          </div>
        ) : null}
        {activity !== undefined && activity.items.length > 0 ? (
          <ol className={styles.list}>
            {activity.items.map((item) => {
              const direction = item.metricAfter > item.metricBefore ? "up" : item.metricAfter < item.metricBefore ? "down" : "flat";
              const strike = item.strikeValueUsd === null ? item.side.toUpperCase() : `${item.side.toUpperCase()} above ${formatValuation(item.strikeValueUsd)}`;
              return (
                <li key={item.marketSequence}>
                  <div>
                    <strong>{item.action === "buy" ? "Bought" : "Sold"} {formatQuantity(item.quantity)} {strike}</strong>
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                  <div className={styles.tradeValues}>
                    <strong>{formatUsdCents(item.cashAmountCents)}</strong>
                    <span className={direction === "up" ? styles.positive : direction === "down" ? styles.negative : undefined}>
                      <span aria-hidden="true">{direction === "up" ? "↑" : direction === "down" ? "↓" : "→"}</span>{" "}
                      {formatMetric(item.metricAfter, item.metricKind)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
      </section>

      <section className={styles.resolution} aria-labelledby="resolution-title">
        <h2 id="resolution-title">Resolution</h2>
        {market.settlement !== null ? (
          <>
            <p>This market settled at <strong>{formatValuation(market.settlement.settledValueUsd)}</strong>.</p>
            <a href={market.settlement.sourceUrl} target="_blank" rel="noreferrer">
              {market.settlement.sourceDescription ?? "Open the settlement source"}
            </a>
          </>
        ) : market.metric.kind === "valuation_median" ? (
          <>
            <p>The winning bucket is determined from the company&apos;s next reported private-market valuation. Settlement records the published source used.</p>
            {market.anchor !== null ? (
              <dl>
                <div><dt>Reference</dt><dd>{formatValuation(market.anchor.valuationUsd)}</dd></div>
                <div><dt>As of</dt><dd>{new Date(`${market.anchor.date}T00:00:00Z`).toLocaleDateString()}</dd></div>
              </dl>
            ) : null}
          </>
        ) : (
          <p>YES pays if the stated outcome is confirmed by the source recorded at settlement. Otherwise, NO pays.</p>
        )}
        {market.anchor?.description !== undefined ? <small>{market.anchor.description}</small> : null}
      </section>
    </div>
  );
}
