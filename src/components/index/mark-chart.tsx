import type { LabelPayload, PrintPayload } from "../../lib/services/index/get-name-index.js";
import { formatPercent, formatPerShare, formatValuation, plural } from "./format.js";
import styles from "./mark-chart.module.css";

/**
 * One label's marks over time, drawn as plain SVG on the server: every
 * family's mark as an ink dot that links its filing, the quarterly
 * consensus (median of families, at the quarter's end) as the red line,
 * the range of the quarter's family marks as a pale band, and the last
 * print as a dashed line: vertical at its announcement, and horizontal at
 * its per-share price when a certificate gives one. Nothing is
 * interpolated: the line joins published consensus points only.
 */

const WIDTH = 720;
const HEIGHT = 280;
const MARGIN = { top: 28, right: 16, bottom: 28, left: 72 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const DAY = 86_400_000;
/** A print outside the marks' dates widens the axis to it only within this many days. */
const PRINT_REACH_DAYS = 400;

function day(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const step = unit < 1.5 ? 1 : unit < 3 ? 2 : unit < 7 ? 5 : 10;
  return step * power;
}

interface YScale {
  readonly log: boolean;
  readonly at: (value: number) => number;
  readonly ticks: readonly number[];
}

function yScale(values: readonly number[]): YScale {
  const positive = values.filter((value) => value > 0);
  const low = Math.min(...positive);
  const high = Math.max(...positive);
  // A wide range reads as ratios; a narrow one as dollars.
  const log = high / low >= 3;
  if (log) {
    const lo = Math.log10(low) - 0.04;
    const hi = Math.log10(high) + 0.04;
    const at = (value: number) =>
      MARGIN.top + PLOT_H - ((Math.log10(value) - lo) / (hi - lo)) * PLOT_H;
    const ticksFor = (units: readonly number[]) => {
      const found: number[] = [];
      for (let power = Math.floor(lo); power <= Math.ceil(hi); power += 1) {
        for (const unit of units) {
          const tick = unit * 10 ** power;
          if (Math.log10(tick) >= lo && Math.log10(tick) <= hi) found.push(tick);
        }
      }
      return found;
    };
    // 1-2-5 per decade; within less than a decade, every integer step.
    let ticks = ticksFor([1, 2, 5]);
    if (ticks.length < 3) ticks = ticksFor([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    while (ticks.length > 6) ticks = ticks.filter((_, i) => i % 2 === 0);
    return { log, at, ticks };
  }
  const pad = high === low ? Math.max(high * 0.1, 1) : (high - low) * 0.12;
  const lo = Math.max(0, low - pad);
  const hi = high + pad;
  const step = niceStep(hi - lo, 4);
  const ticks: number[] = [];
  for (let tick = Math.ceil(lo / step) * step; tick <= hi; tick += step) ticks.push(tick);
  const at = (value: number) => MARGIN.top + PLOT_H - ((value - lo) / (hi - lo)) * PLOT_H;
  return { log, at, ticks };
}

const MONTHS = ["Jan", "Apr", "Jul", "Oct"] as const;

function xTicks(start: number, end: number): { at: number; label: string }[] {
  const years = (end - start) / (365 * DAY);
  const ticks: { at: number; label: string }[] = [];
  const first = new Date(start);
  for (let year = first.getUTCFullYear(); year <= new Date(end).getUTCFullYear(); year += 1) {
    for (const month of years > 2.5 ? [0] : [0, 3, 6, 9]) {
      const at = Date.UTC(year, month, 1);
      if (at >= start && at <= end) {
        ticks.push({ at, label: month === 0 ? `${year}` : `${MONTHS[month / 3]} ${year}` });
      }
    }
  }
  return ticks;
}

export interface MarkChartProps {
  readonly label: LabelPayload;
  readonly lastPrint: PrintPayload | null;
}

/** The chart's one-paragraph reading, for the caption and screen readers. */
export function chartSummary(label: LabelPayload): string {
  const first = label.consensus[0];
  const last = label.consensus.at(-1);
  if (first === undefined || last === undefined) return "No consensus on this label.";
  const range =
    first === last
      ? `Consensus ${formatPerShare(last.consensus_usd)} in ${last.quarter}`
      : `Consensus ${formatPerShare(first.consensus_usd)} in ${first.quarter}, ${formatPerShare(last.consensus_usd)} in ${last.quarter}`;
  const dispersion =
    last.dispersion === null
      ? `${plural(last.n_families, "family", "families")} in ${last.quarter}, too few for dispersion`
      : `dispersion ${formatPercent(last.dispersion.pct)} across ${plural(last.n_families, "family", "families")} in ${last.quarter}`;
  return `${range}; ${dispersion}. ${plural(label.family_marks.length, "family mark")} drawn, each linking its filing.`;
}

export function MarkChart({ label, lastPrint }: MarkChartProps) {
  const marks = label.family_marks;
  if (marks.length === 0) return null;
  const dates = [
    ...marks.map((mark) => day(mark.as_of)),
    ...label.consensus.map((point) => day(point.quarter_end)),
  ];
  let start = Math.min(...dates);
  let end = Math.max(...dates);
  const printDay = lastPrint === null ? null : day(lastPrint.announced_on);
  const printShown =
    printDay !== null &&
    printDay >= start - PRINT_REACH_DAYS * DAY &&
    printDay <= end + PRINT_REACH_DAYS * DAY;
  if (printShown) {
    start = Math.min(start, printDay);
    end = Math.max(end, printDay);
  }
  const span = Math.max(end - start, 90 * DAY);
  start -= span * 0.03;
  end += span * 0.03;
  const x = (at: number) => MARGIN.left + ((at - start) / (end - start)) * PLOT_W;
  const printPps =
    printShown && lastPrint?.price_per_share_usd != null
      ? Number(lastPrint.price_per_share_usd)
      : null;
  const values = [
    ...marks.map((mark) => mark.mark_per_share_usd),
    ...label.consensus.map((point) => point.consensus_usd),
    ...(printPps === null ? [] : [printPps]),
  ];
  const y = yScale(values);
  const consensusPath = label.consensus
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${x(day(point.quarter_end)).toFixed(1)},${y.at(point.consensus_usd).toFixed(1)}`,
    )
    .join(" ");

  return (
    <figure className={styles.figure}>
      <ul className={styles.legend} aria-label="Legend">
        <li>
          <span className={styles.keyDot} aria-hidden="true" />
          Family mark (links its filing)
        </li>
        <li>
          <span className={styles.keyLine} aria-hidden="true" />
          Consensus: median of families, at quarter end
        </li>
        <li>
          <span className={styles.keyBand} aria-hidden="true" />
          Range of the quarter's family marks
        </li>
        {printShown ? (
          <li>
            <span className={styles.keyPrint} aria-hidden="true" />
            Last print
          </li>
        ) : null}
        <li className={styles.scale}>{y.log ? "Log scale" : "Linear scale"}</li>
      </ul>
      <div className={styles.scroller}>
        <svg
          className={styles.chart}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${label.security_label}: ${chartSummary(label)}`}
        >
          {y.ticks.map((tick) => (
            <g key={`y${tick}`}>
              <line
                className={styles.grid}
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={y.at(tick)}
                y2={y.at(tick)}
              />
              <text className={styles.tick} x={MARGIN.left - 8} y={y.at(tick) + 4} textAnchor="end">
                {formatPerShare(tick).replace(/\.00$/, "")}
              </text>
            </g>
          ))}
          {xTicks(start, end).map((tick) => (
            <text
              key={`x${tick.at}`}
              className={styles.tick}
              x={x(tick.at)}
              y={HEIGHT - 8}
              textAnchor="middle"
            >
              {tick.label}
            </text>
          ))}
          <line
            className={styles.axis}
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={MARGIN.top + PLOT_H}
            y2={MARGIN.top + PLOT_H}
          />
          {label.consensus.map((point) => {
            const marksOf = point.families.map((family) => family.mark_per_share_usd);
            const top = y.at(Math.max(...marksOf));
            const bottom = y.at(Math.min(...marksOf));
            return (
              <rect
                key={`band${point.quarter}`}
                className={styles.band}
                x={x(day(point.quarter_end)) - 5}
                width={10}
                y={top - 2}
                height={Math.max(bottom - top, 0) + 4}
              />
            );
          })}
          {printShown && printDay !== null && lastPrint !== null ? (
            <g>
              <line
                className={styles.print}
                x1={x(printDay)}
                x2={x(printDay)}
                y1={MARGIN.top - 6}
                y2={MARGIN.top + PLOT_H}
              />
              <text
                className={styles.printLabel}
                x={x(printDay) + (x(printDay) > WIDTH * 0.7 ? -6 : 6)}
                y={MARGIN.top - 12}
                textAnchor={x(printDay) > WIDTH * 0.7 ? "end" : "start"}
              >
                {lastPrint.round_name}
                {lastPrint.post_money_usd === null
                  ? ""
                  : ` · ${formatValuation(lastPrint.post_money_usd)} post-money`}
                {` · ${lastPrint.announced_on}`}
              </text>
              {printPps === null ? null : (
                <line
                  className={styles.print}
                  x1={MARGIN.left}
                  x2={WIDTH - MARGIN.right}
                  y1={y.at(printPps)}
                  y2={y.at(printPps)}
                />
              )}
            </g>
          ) : null}
          <path className={styles.consensus} d={consensusPath} />
          {label.consensus.map((point) => (
            <circle
              key={`c${point.quarter}`}
              className={styles.consensusPoint}
              cx={x(day(point.quarter_end))}
              cy={y.at(point.consensus_usd)}
              r={4}
            >
              <title>
                {`${point.quarter} consensus ${formatPerShare(point.consensus_usd)} from ${plural(point.n_families, "family", "families")}${point.dispersion === null ? "" : `, dispersion ${formatPercent(point.dispersion.pct)}`}`}
              </title>
            </circle>
          ))}
          {marks.map((mark) => {
            const document = mark.documents[0];
            const cx = x(day(mark.as_of));
            const cy = y.at(mark.mark_per_share_usd);
            const title = `${mark.family_name}, as of ${mark.as_of}: ${formatPerShare(mark.mark_per_share_usd)}${document?.accession ? ` (${document.accession})` : ""}`;
            // One element per dot: a name page draws over a thousand. The
            // wide transparent stroke is the hit area; the title names it.
            const key = `${mark.family_slug}${mark.as_of}`;
            const circle = (
              <circle key={key} className={styles.dot} cx={cx.toFixed(1)} cy={cy.toFixed(1)} r={4}>
                <title>{title}</title>
              </circle>
            );
            return document === undefined ? (
              circle
            ) : (
              <a key={key} href={document.document_url}>
                {circle}
              </a>
            );
          })}
        </svg>
      </div>
      <figcaption className={styles.caption}>
        {chartSummary(label)}
        {lastPrint !== null && !printShown
          ? ` The last print (${lastPrint.round_name}, ${lastPrint.announced_on}) falls outside the marks' dates and is not drawn.`
          : ""}
        {printShown && printPps === null
          ? " The print has no per-share price (no certificate transcribed), so only its date is drawn."
          : ""}
      </figcaption>
    </figure>
  );
}
