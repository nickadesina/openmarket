"use client";

import {
  contractLabel,
  formatCents,
  formatDate,
  formatDateTime,
  formatMetricPrice,
  formatQuantityShort,
  formatValuation,
} from "../../lib/client/format.js";
import { MovementArrow } from "../icons/icons.js";
import type { ActivityPage, MarketDetail } from "../market-workspace/types.js";
import styles from "./market-activity.module.css";

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
            <h2 id="activity-title" className={styles.tab}>
              Market activity
            </h2>
            <p>Completed trades in authoritative market sequence</p>
          </div>
          {error && activity !== undefined ? (
            <button type="button" className={styles.refreshButton} onClick={onRetry}>
              Refresh paused. Retry
            </button>
          ) : loading && activity !== undefined ? (
            <span className={styles.refreshing}>Refreshing</span>
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
            <p>Select a probability in the ladder to preview the first quote.</p>
          </div>
        ) : null}
        {activity !== undefined && activity.items.length > 0 ? (
          <ol className={styles.list}>
            {/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-row label branching; extract an ActivityRow component before growing. */}
            {activity.items.map((item) => {
              const direction =
                item.metricAfter > item.metricBefore
                  ? "up"
                  : item.metricAfter < item.metricBefore
                    ? "down"
                    : "flat";
              const strike = contractLabel(
                item.side,
                item.strikeValueUsd === null ? null : formatValuation(item.strikeValueUsd),
              );
              return (
                <li key={item.marketSequence}>
                  <div>
                    <strong>
                      {item.action === "buy" ? "Bought" : "Sold"}{" "}
                      {formatQuantityShort(item.quantity)} {strike}
                    </strong>
                    <span>{formatDateTime(item.createdAt)}</span>
                  </div>
                  <div className={styles.tradeValues}>
                    <strong>{formatCents(item.cashAmountCents)}</strong>
                    <span
                      className={
                        direction === "up"
                          ? styles.positive
                          : direction === "down"
                            ? styles.negative
                            : undefined
                      }
                    >
                      <MovementArrow direction={direction} />{" "}
                      <span className={styles.visuallyHidden}>
                        {direction === "up"
                          ? "moved up to"
                          : direction === "down"
                            ? "moved down to"
                            : "unchanged at"}
                      </span>
                      {formatMetricPrice(item.metricAfter, item.metricKind)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
      </section>

      <section className={styles.resolution} aria-labelledby="resolution-title">
        <h2 id="resolution-title" className={styles.tab}>
          Resolution
        </h2>
        {market.settlement !== null ? (
          <>
            <p>
              This market settled at{" "}
              <strong>{formatValuation(market.settlement.settledValueUsd)}</strong>.
            </p>
            <a href={market.settlement.sourceUrl} target="_blank" rel="noreferrer">
              {market.settlement.sourceDescription ?? "Open the settlement source"}
            </a>
          </>
        ) : market.metric.kind === "valuation_median" ? (
          <>
            <p>
              The winning bucket is determined from the company&apos;s next reported private-market
              valuation. Settlement records the published source used.
            </p>
            {market.anchor !== null ? (
              <dl>
                <div>
                  <dt>Reference</dt>
                  <dd>{formatValuation(market.anchor.valuationUsd)}</dd>
                </div>
                <div>
                  <dt>As of</dt>
                  <dd>{formatDate(market.anchor.date)}</dd>
                </div>
              </dl>
            ) : null}
          </>
        ) : (
          <p>
            YES pays if the stated outcome is confirmed by the source recorded at settlement.
            Otherwise, NO pays.
          </p>
        )}
        {market.anchor?.description !== undefined ? (
          <small>{market.anchor.description}</small>
        ) : null}
      </section>
    </div>
  );
}
