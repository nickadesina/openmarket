"use client";

import type { UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatMetricPrice } from "../../lib/client/format.js";
import type { MarketDetail, MarkHistory, MarkRange } from "../market-workspace/types.js";
import styles from "./market-chart.module.css";

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

let scratchContext: CanvasRenderingContext2D | null | undefined;

/**
 * lightweight-charts cannot parse oklch() design tokens, and neither
 * getComputedStyle nor a fillStyle round-trip converts them (modern browsers
 * keep oklch colors in their own color space through both). Rasterizing one
 * pixel and reading it back always yields concrete sRGB channel values.
 */
function resolveCssColor(raw: string): string {
  const value = raw.trim();
  if (value === "") return value;
  scratchContext ??= document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (scratchContext === null || scratchContext === undefined) return value;
  scratchContext.clearRect(0, 0, 1, 1);
  scratchContext.fillStyle = "#000000";
  scratchContext.fillStyle = value;
  scratchContext.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = scratchContext.getImageData(0, 0, 1, 1).data;
  return `rgba(${red}, ${green}, ${blue}, ${((alpha ?? 255) / 255).toFixed(3)})`;
}

function cssVar(tokens: CSSStyleDeclaration, name: string): string {
  return resolveCssColor(tokens.getPropertyValue(name));
}

export function MarketChart({
  market,
  marks,
  range,
  loading,
  error,
  onRangeChange,
  onRetry,
}: MarketChartProps) {
  const chartNode = useRef<HTMLDivElement>(null);
  const [renderFailed, setRenderFailed] = useState(false);

  const summary = useMemo(() => {
    if (marks === undefined || marks.points.length === 0) {
      return `Current ${market.metric.label.toLowerCase()} is ${formatMetricPrice(market.metric.current, market.metric.kind)}. No historical changes are available for this range.`;
    }
    // From the level in force at the window start to the current metric,
    // matching the board's change baseline rather than the first print inside.
    const first = marks.openValue;
    const last = marks.currentMetric;
    const delta = last - first;
    const direction = delta > 0 ? "increased" : delta < 0 ? "decreased" : "was unchanged";
    const magnitude = formatMetricPrice(Math.abs(delta), market.metric.kind);
    return `${market.metric.label} ${direction}${delta === 0 ? "" : ` by ${magnitude}`} during the ${range} range, from ${formatMetricPrice(first, market.metric.kind)} to ${formatMetricPrice(last, market.metric.kind)}. The current 60-minute mark is ${formatMetricPrice(marks.mark60Minutes, market.metric.kind)}.`;
  }, [market.metric.current, market.metric.kind, market.metric.label, marks, range]);

  useEffect(() => {
    const container = chartNode.current;
    if (container === null || marks === undefined || marks.points.length === 0) return;

    let disposed = false;
    let observer: ResizeObserver | undefined;
    let cleanupChart: (() => void) | undefined;

    void import("lightweight-charts")
      .then(({ ColorType, createChart, LineSeries }) => {
        if (disposed) return;
        const tokens = getComputedStyle(document.documentElement);
        const chart = createChart(container, {
          width: container.clientWidth,
          height: container.clientHeight,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: cssVar(tokens, "--color-ink-muted"),
            fontFamily: tokens.getPropertyValue("--font-sans").trim(),
            fontSize: 11,
            // Attribution moves to the visible text credit under the chart;
            // the in-pane logo clips against the axis at this pane size.
            attributionLogo: false,
          },
          grid: {
            vertLines: { color: cssVar(tokens, "--color-border-subtle") },
            horzLines: { color: cssVar(tokens, "--color-border-subtle") },
          },
          rightPriceScale: {
            borderColor: cssVar(tokens, "--color-border"),
            // Keeps the topmost tick label clear of the pane edge.
            scaleMargins: { top: 0.12, bottom: 0.08 },
          },
          timeScale: {
            borderColor: cssVar(tokens, "--color-border"),
            timeVisible: range === "1h" || range === "1d",
          },
          crosshair: {
            vertLine: {
              color: cssVar(tokens, "--color-primary"),
              labelBackgroundColor: cssVar(tokens, "--color-primary"),
            },
            horzLine: {
              color: cssVar(tokens, "--color-primary"),
              labelBackgroundColor: cssVar(tokens, "--color-primary"),
            },
          },
          handleScroll: true,
          handleScale: true,
        });

        const priceFormat =
          market.metric.kind === "yes_probability"
            ? ({
                type: "custom",
                formatter: (value: number) => `${(value * 100).toFixed(1)}%`,
                minMove: 0.001,
              } as const)
            : ({
                type: "custom",
                formatter: (value: number) => formatMetricPrice(value, market.metric.kind),
                minMove: 1,
              } as const);
        const currentSeries = chart.addSeries(LineSeries, {
          color: cssVar(tokens, "--color-ink"),
          lineWidth: 2,
          title: market.metric.label,
          priceFormat,
        });
        // The 60-minute mark is one number for the hour that just ended, so it
        // is only drawn on the 1h range, where the window is its own window.
        // Stamped across a day or a week it would claim a flat mark that never was.
        const markSeries =
          range === "1h"
            ? chart.addSeries(LineSeries, {
                color: cssVar(tokens, "--color-primary"),
                lineWidth: 1,
                lineStyle: 2,
                title: "60m mark",
                // The mark's own axis label is redundant with the header's "60m
                // mark" figure and collides with the metric label when they agree.
                lastValueVisible: false,
                priceFormat,
              })
            : null;

        const pointsBySecond = new Map<number, number>();
        for (const point of marks.points)
          pointsBySecond.set(Math.floor(Date.parse(point.timestamp) / 1000), point.value);
        let currentData: ({ time: UTCTimestamp } | { time: UTCTimestamp; value: number })[] =
          Array.from(pointsBySecond, ([time, value]) => ({ time: time as UTCTimestamp, value }));
        // The x-axis spans the selected range, not just the data extent: a "1d"
        // toggle over a one-second burst of trades must still read as a day.
        // lightweight-charts clamps the visible range to the data, so the span
        // is anchored with a whitespace point at the range start.
        // The line opens at the level in force when the window began, so a
        // window with no early prints still shows where the metric stood.
        const windowStart = Math.floor(Date.parse(marks.windowStart) / 1000) as UTCTimestamp;
        const firstPoint = currentData[0];
        if (range !== "all" && (firstPoint === undefined || windowStart < firstPoint.time)) {
          currentData = [{ time: windowStart, value: marks.openValue }, ...currentData];
        }
        currentSeries.setData(currentData);
        markSeries?.setData(currentData.map(({ time }) => ({ time, value: marks.mark60Minutes })));
        chart.timeScale().fitContent();

        observer = new ResizeObserver(([entry]) => {
          if (entry !== undefined)
            chart.applyOptions({
              width: Math.floor(entry.contentRect.width),
              height: Math.floor(entry.contentRect.height),
            });
        });
        observer.observe(container);
        cleanupChart = () => chart.remove();
        setRenderFailed(false);
      })
      .catch(() => {
        if (!disposed) setRenderFailed(true);
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
          <h2 id="market-chart-title" className={styles.tab}>
            Market history
          </h2>
          <p>
            Instantaneous metric
            {range === "1h" ? " and current 60-minute time-weighted mark" : ""} · chart by{" "}
            <a
              href="https://www.tradingview.com/lightweight-charts/"
              rel="noopener noreferrer"
              target="_blank"
            >
              TradingView Lightweight Charts
            </a>
          </p>
        </div>
        <div className={styles.ranges} role="group" aria-label="Chart range">
          {RANGES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={range === item}
              onClick={() => onRangeChange(item)}
            >
              {item === "all" ? "All" : item}
            </button>
          ))}
        </div>
      </header>
      <p className={styles.summary}>{summary}</p>
      {error && marks !== undefined ? (
        <div className={styles.stale} role="status">
          History refresh paused.
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
      <div className={styles.chartFrame}>
        {loading && marks === undefined ? (
          <div
            className={styles.skeleton}
            role="status"
            aria-busy="true"
            aria-label="Loading market chart"
          />
        ) : null}
        {error && marks === undefined ? (
          <div className={styles.message} role="alert">
            <span>History could not be loaded.</span>
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : null}
        {!loading && !error && marks?.points.length === 0 ? (
          <div className={styles.message}>The first trade will begin this history.</div>
        ) : null}
        {renderFailed ? (
          <div className={styles.message} role="alert">
            <span>The chart could not be rendered. The text summary above stays current.</span>
          </div>
        ) : null}
        <div ref={chartNode} className={styles.chart} aria-hidden="true" />
      </div>
    </section>
  );
}
