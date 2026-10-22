import { MIN_PUBLISHED_FORECASTERS } from "../../engine/tournament/aggregate.js";
import type { ForecastPoint } from "../../engine/tournament/forecast.js";
import {
  type BinaryOutcome,
  binaryScore,
  forwardScore,
  type ScoreResult,
  timeAveragedScore,
} from "../../engine/tournament/score.js";
import {
  nullableNumber,
  type QuestionRecord,
  type TournamentDb,
  toForecastPoint,
  windowEnd,
} from "./records.js";

/** How a question resolved, as the scorer needs it: a binary's outcome or a forward's value. */
export type ResolvedAs = { readonly outcome: BinaryOutcome } | { readonly value: number };

/** A stored resolution row's outcome or value. */
export function resolvedAs(row: {
  readonly outcome: BinaryOutcome | null;
  readonly resolved_value: string | null;
}): ResolvedAs {
  if (row.outcome !== null) return { outcome: row.outcome };
  return { value: nullableNumber(row.resolved_value)! };
}

/** The score of holding one forecast once the question resolved `resolved`. */
export function forecastScorer(
  question: Pick<QuestionRecord, "kind">,
  resolved: ResolvedAs,
): (forecast: ForecastPoint) => number {
  if (question.kind === "binary") {
    if (!("outcome" in resolved)) throw new RangeError("a binary resolves by its outcome");
    return (forecast) => binaryScore(forecast.p!, resolved.outcome);
  }
  if (!("value" in resolved)) throw new RangeError("a forward resolves to a value");
  return (forecast) => forwardScore(forecast.value!, resolved.value);
}

export interface UserScore extends ScoreResult {
  readonly userId: string;
}

/**
 * Every forecaster's score from the event log; users with no in-window
 * submission get none, and legacy events are never scored.
 */
export async function computeScores(
  db: TournamentDb,
  question: QuestionRecord,
  resolved: ResolvedAs,
): Promise<UserScore[]> {
  const end = windowEnd(question);
  const events = await db
    .selectFrom("tournament_forecast_events")
    .select(["user_id", "submitted_at", "p", "value"])
    .where("question_id", "=", question.id)
    .where(question.kind === "binary" ? "p" : "value", "is not", null)
    .where("submitted_at", ">=", question.opensAt)
    .where("submitted_at", "<", end)
    .orderBy("user_id")
    .orderBy("submitted_at")
    .execute();

  const byUser = new Map<string, { at: number; forecast: ForecastPoint }[]>();
  for (const event of events) {
    const list = byUser.get(event.user_id) ?? [];
    list.push({ at: event.submitted_at.getTime(), forecast: toForecastPoint(event) });
    byUser.set(event.user_id, list);
  }

  const score = forecastScorer(question, resolved);
  const scores: UserScore[] = [];
  for (const [userId, forecasts] of byUser) {
    const result = timeAveragedScore({
      opensAt: question.opensAt.getTime(),
      closesAt: end.getTime(),
      forecasts,
      score,
    });
    if (result !== null) scores.push({ userId, ...result });
  }
  return scores;
}

/** Writes the immutable score rows for one resolution. */
export async function writeScores(
  db: TournamentDb,
  question: QuestionRecord,
  resolutionId: string,
  resolved: ResolvedAs,
  computedAt: Date,
): Promise<number> {
  const scores = await computeScores(db, question, resolved);
  if (scores.length > 0) {
    await db
      .insertInto("tournament_scores")
      .values(
        scores.map((score) => ({
          resolution_id: resolutionId,
          user_id: score.userId,
          question_id: question.id,
          time_avg_log_score: score.timeAvgLogScore,
          final_log_score: score.finalLogScore,
          coverage: score.coverage,
          computed_at: computedAt,
        })),
      )
      .execute();
  }
  return scores.length;
}

/**
 * The published aggregate scored as if it were a forecaster: its history is
 * the submission log, and stretches where it was unpublished score 0.
 */
export async function aggregateScore(
  db: TournamentDb,
  question: QuestionRecord,
  resolved: ResolvedAs,
): Promise<ScoreResult | null> {
  const end = windowEnd(question);
  const rows = await db
    .selectFrom("tournament_aggregates")
    .select(["computed_at", "p", "value", "n_forecasters"])
    .where("question_id", "=", question.id)
    .where("computed_at", "<", end)
    .orderBy("computed_at")
    .orderBy("id")
    .execute();
  const score = forecastScorer(question, resolved);
  return timeAveragedScore({
    opensAt: question.opensAt.getTime(),
    closesAt: end.getTime(),
    forecasts: rows.map((row) => ({
      at: row.computed_at.getTime(),
      forecast:
        row.n_forecasters >= MIN_PUBLISHED_FORECASTERS && (row.p !== null || row.value !== null)
          ? toForecastPoint(row)
          : null,
    })),
    score: (forecast) => (forecast === null ? 0 : score(forecast)),
  });
}
