import {
  formatProbability,
  formatTournamentMedian,
  type TournamentUnitLabel,
} from "../../lib/client/format.js";
import type { Bucket } from "../../lib/engine/tournament/buckets.js";
import styles from "./tournament-distribution.module.css";

export interface DistributionMedian {
  readonly value: number;
  readonly position: "within" | "below" | "above";
}

interface Series {
  readonly label: string;
  readonly probs: readonly number[];
}

/** Horizontal position of a median across the range buckets, as a fraction of their width. */
function medianOffset(ranges: readonly Bucket[], median: DistributionMedian): number | null {
  const count = ranges.length;
  if (median.position === "below") return 1 / count;
  if (median.position === "above") return (count - 1) / count;
  const position = ranges.findIndex(
    (bucket) =>
      bucket.lower !== null &&
      bucket.upper !== null &&
      median.value >= bucket.lower &&
      median.value <= bucket.upper,
  );
  if (position < 0) return null;
  const { lower, upper } = ranges[position]!;
  const fraction =
    lower! > 0
      ? (Math.log(median.value) - Math.log(lower!)) / (Math.log(upper!) - Math.log(lower!))
      : (median.value - lower!) / (upper! - lower!);
  return (position + fraction) / count;
}

function Column({
  bucket,
  primary,
  overlay,
  scale,
  winning,
  showValues,
}: {
  readonly bucket: Bucket;
  readonly primary: Series | null;
  readonly overlay: Series | null;
  readonly scale: number;
  readonly winning: boolean;
  readonly showValues: boolean;
}) {
  const primaryValue = primary?.probs[bucket.index];
  const overlayValue = overlay?.probs[bucket.index];
  return (
    <div className={`${styles.column} ${winning ? styles.winning : ""}`}>
      <div className={styles.bars}>
        {primaryValue === undefined ? null : (
          <span
            className={`${styles.bar} ${bucket.kind === "floor" ? styles.floorBar : styles.primaryBar}`}
            style={{ height: `${(primaryValue / scale) * 100}%` }}
          />
        )}
        {overlayValue === undefined ? null : (
          <span
            className={`${styles.bar} ${styles.overlayBar}`}
            style={{ height: `${(overlayValue / scale) * 100}%` }}
          />
        )}
      </div>
      {showValues ? (
        <span className={styles.value}>{formatProbability(primaryValue ?? overlayValue ?? 0)}</span>
      ) : null}
      <span className={styles.label}>
        {bucket.label}
        {winning ? <span className={styles.wonMark}>Won</span> : null}
      </span>
    </div>
  );
}

/**
 * The bucket distribution as columns: the primary series filled, an optional
 * comparison outlined beside it, the floor bucket set apart, and the median
 * drawn as a line across the range buckets. A text summary always follows.
 */
export function TournamentDistribution({
  buckets,
  unit,
  primary,
  overlay = null,
  median = null,
  winningIndex = null,
  compact = false,
  summary,
}: {
  readonly buckets: readonly Bucket[];
  readonly unit: TournamentUnitLabel;
  readonly primary: Series | null;
  readonly overlay?: Series | null;
  readonly median?: DistributionMedian | null;
  readonly winningIndex?: number | null;
  readonly compact?: boolean;
  readonly summary: string;
}) {
  const ranges = buckets.filter((bucket) => bucket.kind === "range");
  const floor = buckets.find((bucket) => bucket.kind === "floor");
  const scale = Math.max(0.01, ...(primary?.probs ?? []), ...(overlay?.probs ?? []));
  const offset = median === null || unit === "bool" ? null : medianOffset(ranges, median);
  const column = (bucket: Bucket) => (
    <Column
      key={bucket.index}
      bucket={bucket}
      primary={primary}
      overlay={overlay}
      scale={scale}
      winning={winningIndex === bucket.index}
      showValues={!compact}
    />
  );

  return (
    <figure
      className={`${styles.chart} ${compact ? styles.compact : ""} ${unit === "bool" ? styles.binary : ""}`}
    >
      {primary !== null && overlay !== null ? (
        <div className={styles.legend} aria-hidden="true">
          <span>
            <span className={`${styles.swatch} ${styles.primarySwatch}`} />
            {primary.label}
          </span>
          <span>
            <span className={`${styles.swatch} ${styles.overlaySwatch}`} />
            {overlay.label}
          </span>
        </div>
      ) : null}
      <div className={styles.plot} aria-hidden="true">
        <div className={styles.ranges}>
          {ranges.map(column)}
          {offset === null || median === null ? null : (
            <span className={styles.median} style={{ left: `${offset * 100}%` }}>
              {compact ? null : (
                <span className={styles.medianLabel}>
                  Median {formatTournamentMedian(median.value, median.position, unit)}
                </span>
              )}
            </span>
          )}
        </div>
        {floor === undefined ? null : <div className={styles.floor}>{column(floor)}</div>}
      </div>
      {/* Compact strips sit in lists whose rows already state the figures visually. */}
      <figcaption className={compact ? styles.visuallyHidden : styles.summary}>
        {summary}
      </figcaption>
    </figure>
  );
}
