import {
  formatDateTime,
  formatMetricPrice,
  formatPrice,
  formatUsd,
  formatValuation,
} from "../../lib/client/format.js";
import { CompanyLogo } from "../company-logo/company-logo.js";
import { MovementArrow } from "../icons/icons.js";
import type { MarketDetail } from "../market-workspace/types.js";
import styles from "./market-header.module.css";

interface MarketHeaderProps {
  readonly market: MarketDetail;
  readonly movement: "up" | "down" | "flat";
}

export function MarketHeader({ market, movement }: MarketHeaderProps) {
  const change = market.metric.change24Hours;
  const changeDirection = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const changeAmount =
    market.metric.kind === "valuation_median"
      ? formatPrice(Math.abs(change))
      : `${(Math.abs(change) * 100).toFixed(1)} pts`;
  const changeLabel =
    changeDirection === "flat"
      ? "Unchanged (24h)"
      : `Moved ${changeDirection} ${changeAmount} (24h)`;

  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <CompanyLogo name={market.company.name} logoPath={market.company.logoPath} size="lg" />
        <div>
          <div className={styles.titleRow}>
            <h1>{market.company.name}</h1>
            {market.status === "settled" ? (
              <span className={styles.sealSettled}>Settled</span>
            ) : null}
          </div>
          <p className={styles.prompt}>
            {market.metric.kind === "valuation_median"
              ? "Next reported private-market valuation"
              : "Will the stated outcome occur?"}
          </p>
        </div>
      </div>

      <section className={styles.metrics} aria-label="Current market metrics">
        <div className={styles.primaryMetric}>
          <span>{market.metric.label}</span>
          <strong
            className={
              movement === "up"
                ? styles.flashUp
                : movement === "down"
                  ? styles.flashDown
                  : undefined
            }
          >
            {formatMetricPrice(market.metric.current, market.metric.kind)}
          </strong>
          <small
            className={
              changeDirection === "down"
                ? styles.negative
                : changeDirection === "up"
                  ? styles.positive
                  : styles.muted
            }
          >
            <MovementArrow direction={changeDirection} /> {changeLabel}
          </small>
        </div>
        {/* A spec table in the form convention: gray label cell, white value cell. */}
        <dl className={styles.specTable}>
          <div>
            <dt>60m mark</dt>
            <dd>{formatMetricPrice(market.metric.mark60Minutes, market.metric.kind)}</dd>
          </div>
          <div>
            <dt>Open interest</dt>
            <dd>{formatUsd(market.openInterest)}</dd>
          </div>
          {market.anchor !== null ? (
            <div>
              <dt>Reference anchor</dt>
              <dd>{formatValuation(market.anchor.valuationUsd)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Sequence</dt>
            <dd>No. {market.sequence}</dd>
          </div>
        </dl>
      </section>

      {market.settlement !== null ? (
        <section className={styles.outcome} aria-label="Settlement outcome">
          <div>
            <strong>Resolved at {formatValuation(market.settlement.settledValueUsd)}</strong>
            <span suppressHydrationWarning>{formatDateTime(market.settlement.timestamp)}</span>
          </div>
          <a href={market.settlement.sourceUrl} target="_blank" rel="noreferrer">
            {market.settlement.sourceDescription ?? "View settlement source"}
          </a>
        </section>
      ) : null}
    </header>
  );
}
