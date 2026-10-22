"use client";

import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "../../lib/client/api.js";
import {
  formatProbability,
  formatTournamentDate,
  formatTournamentValue,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { useNow } from "../../lib/client/tournament.js";
import type { QuestionDetail } from "../../lib/services/tournament/get-question.js";
import type { AggregateView } from "../../lib/services/tournament/records.js";
import styles from "./tournament-question.module.css";

const WIDTH = 600;
const HEIGHT = 120;

interface Point {
  readonly at: number;
  readonly value: number;
}

/** Published rows only, each carrying the figure for the question's kind. */
function publishedPoints(question: QuestionDetail, history: readonly AggregateView[]): Point[] {
  return history.flatMap((row) => {
    if (!row.published) return [];
    const value = question.kind === "binary" ? row.p : row.value;
    return value === null ? [] : [{ at: Date.parse(row.computedAt), value }];
  });
}

/**
 * The vertical scale: a binary on 0–100%, a forward in logs between its
 * lowest and highest published median with a tenth of the span either side
 * (a held level gets ±10%).
 */
function scale(question: QuestionDetail, points: readonly Point[]) {
  if (question.kind === "binary") {
    return { low: 0, high: 1, toY: (value: number) => HEIGHT * (1 - value) };
  }
  const logs = points.map((point) => Math.log(point.value));
  let low = Math.min(...logs);
  let high = Math.max(...logs);
  if (high - low < 1e-9) {
    low -= Math.log(1.1);
    high += Math.log(1.1);
  } else {
    const pad = (high - low) / 10;
    low -= pad;
    high += pad;
  }
  return {
    low: Math.exp(low),
    high: Math.exp(high),
    toY: (value: number) => HEIGHT * (1 - (Math.log(value) - low) / (high - low)),
  };
}

/** A step path: each published figure holds until the next one, the last to `end`. */
function stepPath(
  points: readonly Point[],
  start: number,
  end: number,
  toY: (value: number) => number,
): string {
  const span = Math.max(end - start, 1);
  const toX = (at: number) => (WIDTH * (at - start)) / span;
  let path = "";
  points.forEach((point, index) => {
    const x = toX(point.at).toFixed(2);
    const y = toY(point.value).toFixed(2);
    path += index === 0 ? `M${x},${y}` : `H${x}V${y}`;
  });
  return `${path}H${toX(end).toFixed(2)}`;
}

/** The crowd's published figure over time as a step line, with its text summary. */
export function CrowdHistory({ question }: { readonly question: QuestionDetail }) {
  const now = useNow();
  const historyQuery = useQuery({
    queryKey: queryKeys.tournamentAggregateHistory(question.slug),
    queryFn: () =>
      apiRequest<{ history: AggregateView[] }>(
        `/api/t/questions/${question.slug}/aggregate/history`,
      ).then((body) => body.history),
    refetchInterval: 60_000,
  });

  if (historyQuery.isPending) {
    return <div className={styles.historySkeleton} role="status" aria-label="Loading history" />;
  }
  if (historyQuery.isError) {
    return (
      <p className={styles.muted} role="alert">
        The crowd&apos;s history could not be loaded.
      </p>
    );
  }

  const points = publishedPoints(question, historyQuery.data);
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return null;

  const unit = question.unit;
  const format = (value: number) =>
    question.kind === "binary" || unit === null
      ? formatProbability(value)
      : formatTournamentValue(value, unit);
  const windowEnd = Date.parse(question.windowEndsAt);
  const end = Math.max(last.at, Math.min(now ?? last.at, windowEnd));
  const { low, high, toY } = scale(question, points);
  const values = points.map((point) => point.value);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);

  const what = question.kind === "binary" ? "chance of YES" : "median level";
  const summary =
    points.length === 1
      ? `The crowd's ${what} was first published at ${format(first.value)} on ${formatTournamentDate(new Date(first.at).toISOString())} and has not been revised since.`
      : `The crowd's ${what} opened at ${format(first.value)} on ${formatTournamentDate(new Date(first.at).toISOString())} and stands at ${format(last.value)} after ${points.length} published updates, ranging from ${format(lowest)} to ${format(highest)}.`;

  return (
    <figure className={styles.history}>
      <div className={styles.historyPlot}>
        <span className={styles.historyAxis}>{format(high)}</span>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {question.kind === "binary" ? (
            <line
              className={styles.historyGuide}
              x1={0}
              x2={WIDTH}
              y1={toY(0.5)}
              y2={toY(0.5)}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <path
            className={styles.historyLine}
            d={stepPath(points, first.at, end, toY)}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span className={styles.historyAxis}>{format(low)}</span>
      </div>
      <div className={styles.historyDates} aria-hidden="true">
        <span>{formatTournamentDate(new Date(first.at).toISOString())}</span>
        <span>{formatTournamentDate(new Date(end).toISOString())}</span>
      </div>
      <figcaption className={styles.muted}>{summary}</figcaption>
    </figure>
  );
}
