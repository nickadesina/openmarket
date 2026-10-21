"use client";

import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatProbability, formatValuation } from "../../lib/client/format.js";
import type { MarketDetail } from "../market-workspace/types.js";
import styles from "./distribution-chart.module.css";

interface DistributionChartProps {
  readonly market: MarketDetail;
}

const HEIGHT = 220;
const MARGIN = { top: 12, right: 8, bottom: 34, left: 44 } as const;

export function DistributionChart({ market }: DistributionChartProps) {
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
      market.pmf.map((_probability, index) => {
        if (market.metric.kind === "yes_probability") return index === 0 ? "NO" : "YES";
        if (index === 0) return `< ${formatValuation(market.contracts[0]!.strikeValueUsd!)}`;
        if (index === market.pmf.length - 1)
          return `> ${formatValuation(market.contracts.at(-1)!.strikeValueUsd!)}`;
        return `${formatValuation(market.contracts[index - 1]!.strikeValueUsd!)} to ${formatValuation(market.contracts[index]!.strikeValueUsd!)}`;
      }),
    [market],
  );

  const topBuckets = useMemo(
    () =>
      market.pmf
        .map((probability, index) => ({ probability, label: labels[index]! }))
        .sort((left, right) => right.probability - left.probability)
        .slice(0, 3),
    [labels, market.pmf],
  );

  const winningLabel =
    market.settlement === null ? null : (labels[market.settlement.winningBucket] ?? null);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = scaleBand<number>({
    domain: market.pmf.map((_value, index) => index),
    range: [0, innerWidth],
    padding: market.pmf.length > 2 ? 0.12 : 0.35,
  });
  const yScale = scaleLinear<number>({
    domain: [0, Math.max(...market.pmf, 0.01)],
    range: [innerHeight, 0],
    nice: true,
  });

  return (
    // Open from first paint: the distribution is the product's central idea.
    <details className={styles.section} open>
      <summary>
        <span>
          <strong className={styles.tab}>Implied distribution</strong>
          <small>Probability mass across possible outcomes</small>
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
        .{winningLabel === null ? "" : ` Settled winning outcome (★): ${winningLabel}.`}
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
            {winningLabel === null ? "" : `. Winning outcome: ${winningLabel}`}
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
            {market.pmf.map((probability, index) => {
              const barX = xScale(index) ?? 0;
              const barY = yScale(probability);
              const barWidth = xScale.bandwidth();
              const barHeight = innerHeight - barY;
              const isWinning = market.settlement?.winningBucket === index;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: the index is the bucket's identity.
                <g key={index}>
                  <title>{`${labels[index]!}: ${formatProbability(probability)}`}</title>
                  <Bar
                    x={barX}
                    y={barY}
                    width={barWidth}
                    height={barHeight}
                    rx={2}
                    className={(isWinning ? styles.winningBar : styles.bar)!}
                  />
                  {isWinning ? (
                    <text
                      x={barX + barWidth / 2}
                      y={Math.max(barY - 4, 10)}
                      textAnchor="middle"
                      className={styles.winnerMarker}
                    >
                      <title>Winning bucket</title>★
                    </text>
                  ) : null}
                </g>
              );
            })}
            {market.pmf.length === 2 ? (
              market.pmf.map((probability, index) => (
                <text
                  key={index === 0 ? "no" : "yes"}
                  x={(xScale(index) ?? 0) + xScale.bandwidth() / 2}
                  y={innerHeight + 22}
                  textAnchor="middle"
                  className={styles.axisLabel}
                >
                  {index === 0 ? "NO" : "YES"} {formatProbability(probability)}
                </text>
              ))
            ) : (
              <>
                {[9, 19, 29].map((strikeIndex) => {
                  const strike = market.contracts[strikeIndex]?.strikeValueUsd;
                  if (strike == null) return null;
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
                        {formatValuation(strike)}
                      </text>
                    </g>
                  );
                })}
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
            )}
          </Group>
        </svg>
      </div>
    </details>
  );
}
