import {
  formatDate,
  formatDateTime,
  formatMetricPrice,
  formatPrice,
  formatProbability,
  formatUsd,
  formatValuation,
  roundChange,
} from "../../lib/client/format.js";
import { CompanyLogo } from "../company-logo/company-logo.js";
import { computeBand } from "../home-distribution/home-distribution.js";
import { MovementArrow } from "../icons/icons.js";
import type { MarketDetail } from "../market-workspace/types.js";
import styles from "./market-header.module.css";

interface MarketHeaderProps {
  readonly market: MarketDetail;
  readonly movement: "up" | "down" | "flat";
}

const directionClass = {
  up: styles.positive,
  down: styles.negative,
  flat: styles.muted,
} as const;

function dayChange(market: MarketDetail) {
  const change = market.metric.change24Hours;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const amount =
    market.metric.kind === "valuation_median"
      ? formatPrice(Math.abs(change))
      : `${(Math.abs(change) * 100).toFixed(1)} pts`;
  return {
    direction,
    label: direction === "flat" ? "Unchanged (24h)" : `Moved ${direction} ${amount} (24h)`,
  } as const;
}

/**
 * The quote band: one ruled row that reads like a brokerage quote page, name
 * first, then the level and every figure that frames it.
 */
export function MarketHeader({ market, movement }: MarketHeaderProps) {
  const day = dayChange(market);
  const round =
    market.anchor === null ? null : roundChange(market.metric.current, market.anchor.valuationUsd);
  const band = computeBand(market);
  const lastTrade = market.recentActivity[0]?.createdAt;

  return (
    <header className={styles.header}>
      <div className={styles.band}>
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

        <dl className={styles.cells} aria-label="Current market metrics">
          <div className={styles.cell}>
            <dt>{market.metric.label}</dt>
            <dd
              className={`${styles.price} ${movement === "up" ? styles.flashUp : movement === "down" ? styles.flashDown : ""}`}
            >
              {formatMetricPrice(market.metric.current, market.metric.kind)}
            </dd>
            <dd className={`${styles.note} ${directionClass[day.direction]}`}>
              <MovementArrow direction={day.direction} /> {day.label}
            </dd>
          </div>

          {round === null || market.anchor === null ? null : (
            <div className={styles.cell}>
              <dt>Vs last round</dt>
              <dd className={`${styles.figure} ${directionClass[round.direction]}`}>
                <MovementArrow direction={round.direction} /> {round.label}
              </dd>
              <dd className={styles.note}>
                <span title={market.anchor.description}>
                  {formatValuation(market.anchor.valuationUsd)}
                </span>{" "}
                · <time dateTime={market.anchor.date}>{formatDate(market.anchor.date)}</time>
              </dd>
            </div>
          )}

          {band === null ? null : (
            <div className={styles.cell}>
              <dt>80% band</dt>
              <dd className={styles.figure}>
                {formatPrice(band.lower)} – {formatPrice(band.upper)}
              </dd>
              {band.mode.from !== null && band.mode.to !== null ? (
                <dd className={styles.note}>
                  Most likely {formatValuation(band.mode.from)}–{formatValuation(band.mode.to)} ·{" "}
                  {formatProbability(band.mode.mass)}
                </dd>
              ) : null}
            </div>
          )}

          <div className={styles.cell}>
            <dt>Open interest</dt>
            <dd className={styles.figure}>{formatUsd(market.openInterest)}</dd>
          </div>

          <div className={styles.cell}>
            <dt>Last trade</dt>
            <dd className={styles.figure}>
              {/* ICU output differs between Node and the browser; the client value wins. */}
              <time dateTime={lastTrade} suppressHydrationWarning>
                {lastTrade === undefined ? "None yet" : formatDateTime(lastTrade)}
              </time>
            </dd>
            <dd className={styles.note}>Sequence No. {market.sequence}</dd>
          </div>
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
