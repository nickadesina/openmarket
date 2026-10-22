"use client";

import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatPrice, formatProbability, formatValuation } from "../../lib/client/format.js";
import type { ImpliedDistribution } from "../market-workspace/types.js";
import styles from "./distribution-chart.module.css";

interface DistributionChartProps {
  readonly distribution: ImpliedDistribution;
}

const HEIGHT = 220;
const MARGIN = { top: 12, right: 8, bottom: 34, left: 44 } as const;
const LABELLED_STRIKES = [9, 19, 29] as const;
const WIDE_AXIS = 520;

/** The 41 bucket masses of the API's implied distribution, read-only. */
export function DistributionChart({ distribution }: DistributionChartProps) {
  const { pmf, strikes } = distribution;
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const node = frame.current;
    if (node === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.max(280, Math.floor(entry.contentRect.width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const labels = useMemo(
    () =>
      pmf.map((_probability, index) => {
        if (index === 0) return `< ${formatValuation(strikes[0]!.strikeValueUsd)}`;
        if (index === pmf.length - 1) return `> ${formatValuation(strikes.at(-1)!.strikeValueUsd)}`;
        return `${formatValuation(strikes[index - 1]!.strikeValueUsd)} to ${formatValuation(strikes[index]!.strikeValueUsd)}`;
      }),
    [pmf, strikes],
  );

  const topBuckets = useMemo(
    () =>
      pmf
        .map((probability, index) => ({ probability, label: labels[index]! }))
        .sort((left, right) => right.probability - left.probability)
        .slice(0, 3),
    [labels, pmf],
  );

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = scaleBand<number>({
    domain: pmf.map((_value, index) => index),
    range: [0, innerWidth],
    padding: 0.12,
  });
  const yScale = scaleLinear<number>({
    domain: [0, Math.max(...pmf, 0.01)],
    range: [innerHeight, 0],
    nice: true,
  });

  return (
    // Open from first paint: the distribution is how the forward mid reads as a range.
    <details className={styles.section} open>
      <summary>
        <span>
          <strong className={styles.tab}>Implied distribution</strong>
          <small>
            Lognormal at the forward mid {formatPrice(distribution.centerUsd)}, σ{" "}
            {distribution.sigma.toFixed(2)}
          </small>
        </span>
        <span aria-hidden="true">
          <span className={styles.whenOpen}>Collapse</span>
          <span className={styles.whenClosed}>Expand</span>
        </span>
      </summary>
      <p className={styles.textSummary}>
        Highest-probability outcomes:{" "}
        {topBuckets
          .map((bucket) => `${bucket.label} at ${formatProbability(bucket.probability)}`)
          .join(", ")}
        . 80% of the mass lies between {formatPrice(distribution.band.p10)} and{" "}
        {formatPrice(distribution.band.p90)}.
      </p>
      <div ref={frame} className={styles.chart}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-labelledby="distribution-title distribution-description"
        >
          <title id="distribution-title">Implied probability distribution</title>
          <desc id="distribution-description">
            {topBuckets
              .map((bucket) => `${bucket.label}, ${formatProbability(bucket.probability)}`)
              .join("; ")}
          </desc>
          <Group left={MARGIN.left} top={MARGIN.top}>
            {yScale.ticks(3).map((tick) => (
              <g key={`tick-${tick}`}>
                <line
                  x1={0}
                  x2={innerWidth}
                  y1={yScale(tick)}
                  y2={yScale(tick)}
                  className={styles.gridLine}
                />
                <text
                  x={-8}
                  y={yScale(tick)}
                  dy="0.32em"
                  textAnchor="end"
                  className={styles.axisLabel}
                >
                  {formatProbability(tick)}
                </text>
              </g>
            ))}
            {pmf.map((probability, index) => {
              const barY = yScale(probability);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: the index is the bucket's identity.
                <g key={index}>
                  <title>{`${labels[index]!}: ${formatProbability(probability)}`}</title>
                  <Bar
                    x={xScale(index) ?? 0}
                    y={barY}
                    width={xScale.bandwidth()}
                    height={innerHeight - barY}
                    className={styles.bar!}
                  />
                </g>
              );
            })}
            {LABELLED_STRIKES.map((strikeIndex) => {
              const strike = strikes[strikeIndex];
              if (strike === undefined) return null;
              const boundaryX =
                (xScale(strikeIndex) ?? 0) +
                xScale.bandwidth() +
                (xScale.step() - xScale.bandwidth()) / 2;
              return (
                <g key={`strike-${strikeIndex}`}>
                  <line
                    x1={boundaryX}
                    x2={boundaryX}
                    y1={innerHeight}
                    y2={innerHeight + 5}
                    className={styles.tickLine}
                  />
                  <text
                    x={boundaryX}
                    y={innerHeight + 22}
                    textAnchor="middle"
                    className={styles.axisLabel}
                  >
                    {formatValuation(strike.strikeValueUsd)}
                  </text>
                </g>
              );
            })}
            {/* The end captions collide with the strike labels on a phone-width axis. */}
            {innerWidth >= WIDE_AXIS ? (
              <>
                <text x="0" y={innerHeight + 22} className={styles.axisLabel}>
                  Lower valuation
                </text>
                <text
                  x={innerWidth}
                  y={innerHeight + 22}
                  textAnchor="end"
                  className={styles.axisLabel}
                >
                  Higher valuation
                </text>
              </>
            ) : null}
          </Group>
        </svg>
      </div>
    </details>
  );
}
