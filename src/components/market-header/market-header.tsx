import { formatDateTime, formatMetric, formatValuation } from "../../lib/client/format.js";
import { MovementArrow } from "../icons/icons.js";
import { CompanyLogo } from "../company-logo/company-logo.js";
import type { MarketDetail } from "../market-workspace/types.js";
import styles from "./market-header.module.css";

const claimsFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

interface MarketHeaderProps {
  readonly market: MarketDetail;
  readonly movement: "up" | "down" | "flat";
}

export function MarketHeader({ market, movement }: MarketHeaderProps) {
  const change = market.metric.change24Hours;
  const changeDirection = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const changeAmount = market.metric.kind === "valuation_median"
    ? formatValuation(Math.abs(change))
    : `${(Math.abs(change) * 100).toFixed(1)} pts`;
  const changeLabel = changeDirection === "flat"
    ? "Unchanged (24h)"
    : `Moved ${changeDirection} ${changeAmount} (24h)`;

  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <CompanyLogo name={market.company.name} logoPath={market.company.logoPath} size="lg" />
        <div>
          <div className={styles.titleRow}>
            <h1>{market.company.name}</h1>
            <span className={market.status === "settled" ? styles.settled : styles.open}>
              {market.status === "settled" ? "Settled" : "Open"}
            </span>
          </div>
          <p className={styles.prompt}>
            {market.metric.kind === "valuation_median"
              ? "Next reported private-market valuation"
              : "Will the stated outcome occur?"}
          </p>
        </div>
      </div>

      <div className={styles.metrics} aria-label="Current market metrics">
        <div className={styles.primaryMetric}>
          <span>{market.metric.label}</span>
          <strong className={movement === "up" ? styles.flashUp : movement === "down" ? styles.flashDown : undefined}>
            {formatMetric(market.metric.current, market.metric.kind)}
          </strong>
          <small className={changeDirection === "down" ? styles.negative : changeDirection === "up" ? styles.positive : styles.muted}>
            <MovementArrow direction={changeDirection} /> {changeLabel}
          </small>
        </div>
        <dl className={styles.secondaryMetrics}>
          <div>
            <dt>60m mark</dt>
            <dd>{formatMetric(market.metric.mark60Minutes, market.metric.kind)}</dd>
          </div>
          <div>
            <dt>Claims</dt>
            <dd>{claimsFormatter.format(market.outstandingClaims)}</dd>
          </div>
          {market.anchor !== null ? (
            <div>
              <dt>Reference anchor</dt>
              <dd>{formatValuation(market.anchor.valuationUsd)}</dd>
            </div>
          ) : null}
        </dl>
      </div>

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
