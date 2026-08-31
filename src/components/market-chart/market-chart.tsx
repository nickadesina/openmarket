"use client";

import { useEffect, useMemo, useRef } from "react";
import type { UTCTimestamp } from "lightweight-charts";

import styles from "./market-chart.module.css";
import { formatMetric, type MarkHistory, type MarkRange, type MarketDetail } from "../market-workspace/types.js";

interface MarketChartProps {
  readonly market: MarketDetail;
  readonly marks: MarkHistory | undefined;
  readonly range: MarkRange;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRangeChange: (range: MarkRange) => void;
  readonly onRetry: () => void;
}

const RANGES: readonly MarkRange[] = ["1h", "1d", "1w", "all"];

export function MarketChart({ market, marks, range, loading, error, onRangeChange, onRetry }: MarketChartProps) {
  const chartNode = useRef<HTMLDivElement>(null);

  const summary = useMemo(() => {
    if (marks === undefined || marks.points.length === 0) {
      return `Current ${market.metric.label.toLowerCase()} is ${formatMetric(market.metric.current, market.metric.kind)}. No historical changes are available for this range.`;
    }
    const first = marks.points[0]!.value;
    const last = marks.points[marks.points.length - 1]!.value;
    const delta = last - first;
    const direction = delta > 0 ? "increased" : delta < 0 ? "decreased" : "was unchanged";
    const magnitude = market.metric.kind === "yes_probability"
      ? new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(delta))
      : formatMetric(Math.abs(delta), market.metric.kind);
    return `${market.metric.label} ${direction}${delta === 0 ? "" : ` by ${magnitude}`} during the ${range} range, from ${formatMetric(first, market.metric.kind)} to ${formatMetric(last, market.metric.kind)}. The current 60-minute mark is ${formatMetric(marks.mark60Minutes, market.metric.kind)}.`;
  }, [market.metric.current, market.metric.kind, market.metric.label, marks, range]);

  useEffect(() => {
    const container = chartNode.current;
    if (container === null || marks === undefined || marks.points.length === 0) return;

    let disposed = false;
    let observer: ResizeObserver | undefined;
    let cleanupChart: (() => void) | undefined;

    void import("lightweight-charts").then(({ ColorType, createChart, LineSeries }) => {
      if (disposed) return;
      const tokens = getComputedStyle(document.documentElement);
      const chart = createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: tokens.getPropertyValue("--color-ink-muted").trim(),
          fontFamily: tokens.getPropertyValue("--font-sans").trim(),
          fontSize: 11,
        },
        grid: {
          vertLines: { color: tokens.getPropertyValue("--color-border-subtle").trim() },
          horzLines: { color: tokens.getPropertyValue("--color-border-subtle").trim() },
        },
        rightPriceScale: { borderColor: tokens.getPropertyValue("--color-border").trim() },
        timeScale: { borderColor: tokens.getPropertyValue("--color-border").trim(), timeVisible: range === "1h" || range === "1d" },
        crosshair: {
          vertLine: { color: tokens.getPropertyValue("--color-primary").trim(), labelBackgroundColor: tokens.getPropertyValue("--color-primary").trim() },
          horzLine: { color: tokens.getPropertyValue("--color-primary").trim(), labelBackgroundColor: tokens.getPropertyValue("--color-primary").trim() },
        },
        handleScroll: true,
        handleScale: true,
      });

      const currentSeries = chart.addSeries(LineSeries, {
        color: tokens.getPropertyValue("--color-accent").trim(),
        lineWidth: 2,
        title: market.metric.label,
        priceFormat: market.metric.kind === "yes_probability"
          ? { type: "custom", formatter: (value: number) => `${(value * 100).toFixed(1)}%`, minMove: 0.001 }
          : { type: "custom", formatter: (value: number) => formatMetric(value, market.metric.kind), minMove: 1 },
      });
      const markSeries = chart.addSeries(LineSeries, {
        color: tokens.getPropertyValue("--color-primary").trim(),
        lineWidth: 1,
        lineStyle: 2,
        title: "60m mark",
        priceFormat: market.metric.kind === "yes_probability"
          ? { type: "custom", formatter: (value: number) => `${(value * 100).toFixed(1)}%`, minMove: 0.001 }
          : { type: "custom", formatter: (value: number) => formatMetric(value, market.metric.kind), minMove: 1 },
      });

      const pointsBySecond = new Map<number, number>();
      for (const point of marks.points) pointsBySecond.set(Math.floor(Date.parse(point.timestamp) / 1000), point.value);
      const currentData = Array.from(pointsBySecond, ([time, value]) => ({ time: time as UTCTimestamp, value }));
      currentSeries.setData(currentData);
      markSeries.setData(currentData.map(({ time }) => ({ time, value: marks.mark60Minutes })));
      chart.timeScale().fitContent();

      observer = new ResizeObserver(([entry]) => {
        if (entry !== undefined) chart.applyOptions({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
      });
      observer.observe(container);
      cleanupChart = () => chart.remove();
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      cleanupChart?.();
    };
  }, [market.metric.kind, market.metric.label, marks, range]);

  return (
    <section className={styles.section} aria-labelledby="market-chart-title">
      <header className={styles.header}>
        <div>
          <h2 id="market-chart-title">Market history</h2>
          <p>Instantaneous metric and current 60-minute time-weighted mark</p>
        </div>
        <div className={styles.ranges} aria-label="Chart range">
          {RANGES.map((item) => (
            <button key={item} type="button" aria-pressed={range === item} onClick={() => onRangeChange(item)}>
              {item === "all" ? "All" : item}
            </button>
          ))}
        </div>
      </header>
      <p className={styles.summary}>{summary}</p>
      {error && marks !== undefined ? (
        <div className={styles.stale} role="status">
          History refresh paused.
          <button type="button" onClick={onRetry}>Retry</button>
        </div>
      ) : null}
      <div className={styles.chartFrame}>
        {loading && marks === undefined ? <div className={styles.skeleton} aria-label="Loading market chart" /> : null}
        {error && marks === undefined ? (
          <div className={styles.message} role="alert">
            <span>History could not be loaded.</span>
            <button type="button" onClick={onRetry}>Retry</button>
          </div>
        ) : null}
        {!loading && !error && marks?.points.length === 0 ? (
          <div className={styles.message}>The first trade will begin this history.</div>
        ) : null}
        <div ref={chartNode} className={styles.chart} aria-hidden="true" />
      </div>
    </section>
  );
}
