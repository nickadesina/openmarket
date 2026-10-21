"use client";

import type { UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatDateTime, formatMetricPrice } from "../../lib/client/format.js";
import type { MarkHistory, MarkRange } from "../market-workspace/types.js";
import styles from "./market-chart.module.css";

interface MarketChartProps {
  /** What the line is, as the summary names it: "Forward mid". */
  readonly label: string;
  readonly marks: MarkHistory | undefined;
  readonly lastTradeAt: string | null;
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

type ChartPoint = { time: UTCTimestamp } | { time: UTCTimestamp; value: number };

/** Line data for the metric series: deduped prints, a whitespace anchor at
 *  the window start, and a pinned current point so the endpoint agrees with
 *  the text summary when the latest print predates the live metric. */
// Half-width of the price band framing a level held through a quiet range.
const HELD_BAND = 0.03;

function buildCurrentData(marks: MarkHistory, range: MarkRange): ChartPoint[] {
  const pointsBySecond = new Map<number, number>();
  for (const point of marks.points)
    pointsBySecond.set(Math.floor(Date.parse(point.timestamp) / 1000), point.value);
  let data: ChartPoint[] = Array.from(pointsBySecond, ([time, value]) => ({
    time: time as UTCTimestamp,
    value,
  }));
  // The x-axis spans the selected range, not just the data extent: a "1d"
  // toggle over a one-second burst of trades must still read as a day.
  // lightweight-charts clamps the visible range to the data, so the span
  // is anchored with a whitespace point at the range start.
  // The line opens at the level in force when the window began, so a
  // window with no early prints still shows where the metric stood.
  const windowStart = Math.floor(Date.parse(marks.windowStart) / 1000) as UTCTimestamp;
  const firstPoint = data[0];
  if (range !== "all" && (firstPoint === undefined || windowStart < firstPoint.time)) {
    const startPoint =
      data.length === 1 ? { time: windowStart } : { time: windowStart, value: marks.openValue };
    data = [startPoint, ...data];
  }
  // A same-second collision overwrites instead of appending; the chart
  // rejects duplicate timestamps.
  const windowEnd = Math.floor(Date.parse(marks.windowEnd) / 1000) as UTCTimestamp;
  const lastPoint = data[data.length - 1];
  const lastValue = lastPoint !== undefined && "value" in lastPoint ? lastPoint.value : undefined;
  if (
    lastPoint !== undefined &&
    (lastPoint.time < windowEnd || lastValue !== marks.currentMetric)
  ) {
    data =
      lastPoint.time === windowEnd
        ? [...data.slice(0, -1), { time: windowEnd, value: marks.currentMetric }]
        : [...data, { time: windowEnd, value: marks.currentMetric }];
  }
  return data;
}

export function MarketChart({
  label,
  marks,
  lastTradeAt,
  range,
  loading,
  error,
  onRangeChange,
  onRetry,
}: MarketChartProps) {
  const chartNode = useRef<HTMLDivElement>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  const kind = marks?.metricKind ?? "forward_ln";

  // A book has a level from its listing mark on; a quiet range holds the level
  // in force at the window start and ends at the current one.
  const summary = useMemo(() => {
    if (marks === undefined) return `${label} history is loading.`;
    const first = marks.openValue;
    const last = marks.currentMetric;
    const delta = last - first;
    const direction = delta > 0 ? "rose" : delta < 0 ? "fell" : "held";
    const magnitude = formatMetricPrice(Math.abs(delta), kind);
    const quiet =
      marks.points.length === 0
        ? `No fills in the ${range} range${lastTradeAt === null ? "" : `; the last was on ${formatDateTime(lastTradeAt)}`}. `
        : "";
    return delta === 0
      ? `${quiet}${label} held at ${formatMetricPrice(last, kind)} through the ${range} range.`
      : `${quiet}${label} ${direction} by ${magnitude} during the ${range} range, from ${formatMetricPrice(first, kind)} to ${formatMetricPrice(last, kind)}.`;
  }, [kind, label, lastTradeAt, marks, range]);

  useEffect(() => {
    const container = chartNode.current;
    if (container === null || marks === undefined) return;

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
          kind === "yes_probability"
            ? ({
                type: "custom",
                formatter: (value: number) => `${(value * 100).toFixed(1)}%`,
                minMove: 0.001,
              } as const)
            : ({
                type: "custom",
                formatter: (value: number) => formatMetricPrice(value, kind),
                minMove: 1,
              } as const);
        // A held level is a flat line; autoscaled, its axis would repeat one
        // label at every tick. Frame it with a band either side instead.
        const held = marks.points.length === 0 ? marks.currentMetric : null;
        const currentSeries = chart.addSeries(LineSeries, {
          color: cssVar(tokens, "--color-ink"),
          lineWidth: 2,
          title: label,
          priceFormat,
          ...(held === null
            ? {}
            : {
                autoscaleInfoProvider: () => ({
                  priceRange: {
                    minValue: held * (1 - HELD_BAND),
                    maxValue: held * (1 + HELD_BAND),
                  },
                }),
              }),
        });
        const currentData = buildCurrentData(marks, range);
        currentSeries.setData(currentData);
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
  }, [kind, label, marks, range]);

  return (
    <section className={styles.section} aria-labelledby="market-chart-title">
      <header className={styles.header}>
        <div>
          <h2 id="market-chart-title" className={styles.tab}>
            {label} history
          </h2>
          <p>
            Model mid at listing and at each fill, ending at the live mid · chart by{" "}
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
      {/* ICU date output differs between Node and the browser; the client value wins. */}
      <p className={styles.summary} suppressHydrationWarning>
        {summary}
      </p>
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
