import styles from "./market-header.module.css";
import { formatMetric, formatValuation, type MarketDetail } from "../market-workspace/types.js";

interface MarketHeaderProps {
  readonly market: MarketDetail;
  readonly movement: "up" | "down" | "flat";
}

export function MarketHeader({ market, movement }: MarketHeaderProps) {
  const movementLabel = movement === "up" ? "Moved up" : movement === "down" ? "Moved down" : "Unchanged";
  const movementGlyph = movement === "up" ? "↑" : movement === "down" ? "↓" : "→";

  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        {/* Company-provided paths are rendered as normal images so a missing logo does not block the market title. */}
        <img className={styles.logo} src={market.company.logoPath} alt="" width="40" height="40" />
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
          <small className={movement === "down" ? styles.negative : movement === "up" ? styles.positive : styles.muted}>
            <span aria-hidden="true">{movementGlyph}</span> {movementLabel}
          </small>
        </div>
        <dl className={styles.secondaryMetrics}>
          <div>
            <dt>60m mark</dt>
            <dd>{formatMetric(market.metric.mark60Minutes, market.metric.kind)}</dd>
          </div>
          <div>
            <dt>Claims</dt>
            <dd>{new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(market.outstandingClaims)}</dd>
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
            <span>{new Date(market.settlement.timestamp).toLocaleString()}</span>
          </div>
          <a href={market.settlement.sourceUrl} target="_blank" rel="noreferrer">
            {market.settlement.sourceDescription ?? "View settlement source"}
          </a>
        </section>
      ) : null}
    </header>
  );
}
