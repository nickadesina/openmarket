"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";

import styles from "./distribution-chart.module.css";
import { formatProbability, formatValuation, type MarketDetail } from "../market-workspace/types.js";

interface DistributionChartProps {
  readonly market: MarketDetail;
}

const HEIGHT = 220;
const MARGIN = { top: 12, right: 8, bottom: 34, left: 8 } as const;

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

  const labels = useMemo(() => market.pmf.map((_probability, index) => {
    if (market.metric.kind === "yes_probability") return index === 0 ? "NO" : "YES";
    if (index === 0) return `< ${formatValuation(market.contracts[0]!.strikeValueUsd!)}`;
    if (index === market.pmf.length - 1) return `> ${formatValuation(market.contracts.at(-1)!.strikeValueUsd!)}`;
    return `${formatValuation(market.contracts[index - 1]!.strikeValueUsd!)} to ${formatValuation(market.contracts[index]!.strikeValueUsd!)}`;
  }), [market]);

  const topBuckets = useMemo(() => market.pmf
    .map((probability, index) => ({ probability, label: labels[index]! }))
    .sort((left, right) => right.probability - left.probability)
    .slice(0, 3), [labels, market.pmf]);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = scaleBand<number>({ domain: market.pmf.map((_value, index) => index), range: [0, innerWidth], padding: market.pmf.length > 2 ? 0.12 : 0.35 });
  const yScale = scaleLinear<number>({ domain: [0, Math.max(...market.pmf, 0.01)], range: [innerHeight, 0], nice: true });

  return (
    <details className={styles.section}>
      <summary>
        <span>
          <strong>Implied distribution</strong>
          <small>Probability mass across possible outcomes</small>
        </span>
        <span aria-hidden="true">Expand</span>
      </summary>
      <p className={styles.textSummary}>
        Highest-probability outcomes: {topBuckets.map((bucket) => `${bucket.label} at ${formatProbability(bucket.probability)}`).join(", ")}.
      </p>
      <div ref={frame} className={styles.chart}>
        <svg width={width} height={HEIGHT} role="img" aria-labelledby="distribution-title distribution-description">
          <title id="distribution-title">Implied probability distribution</title>
          <desc id="distribution-description">{topBuckets.map((bucket) => `${bucket.label}, ${formatProbability(bucket.probability)}`).join("; ")}</desc>
          <Group left={MARGIN.left} top={MARGIN.top}>
            {market.pmf.map((probability, index) => {
              const barX = xScale(index) ?? 0;
              const barY = yScale(probability);
              const barWidth = xScale.bandwidth();
              const barHeight = innerHeight - barY;
              const isWinning = market.settlement?.winningBucket === index;
              return (
                <Bar
                  key={index}
                  x={barX}
                  y={barY}
                  width={barWidth}
                  height={barHeight}
                  rx={2}
                  className={(isWinning ? styles.winningBar : styles.bar)!}
                />
              );
            })}
            {market.pmf.length === 2 ? market.pmf.map((probability, index) => (
              <text key={index} x={(xScale(index) ?? 0) + xScale.bandwidth() / 2} y={innerHeight + 22} textAnchor="middle" className={styles.axisLabel}>
                {index === 0 ? "NO" : "YES"} {formatProbability(probability)}
              </text>
            )) : (
              <>
                <text x="0" y={innerHeight + 22} className={styles.axisLabel}>Lower valuation</text>
                <text x={innerWidth} y={innerHeight + 22} textAnchor="end" className={styles.axisLabel}>Higher valuation</text>
              </>
            )}
          </Group>
        </svg>
      </div>
    </details>
  );
}
