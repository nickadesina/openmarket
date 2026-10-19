import { MIN_PUBLISHED_FORECASTERS } from "../../engine/tournament/aggregate.js";
import { type ScoreResult, timeAveragedScore } from "../../engine/tournament/score.js";
import { type QuestionRecord, type TournamentDb, toNumbers, windowEnd } from "./records.js";

export interface UserScore extends ScoreResult {
  readonly userId: string;
}

/** Every forecaster's score from the event log; users with no in-window submission get none. */
export async function computeScores(
  db: TournamentDb,
  question: QuestionRecord,
  winningIndex: number,
): Promise<UserScore[]> {
  const end = windowEnd(question);
  const events = await db
    .selectFrom("tournament_forecast_events")
    .select(["user_id", "submitted_at", "probs"])
    .where("question_id", "=", question.id)
    .where("submitted_at", ">=", question.opensAt)
    .where("submitted_at", "<", end)
    .orderBy("user_id")
    .orderBy("submitted_at")
    .execute();

  const byUser = new Map<string, { at: number; probs: number[] }[]>();
  for (const event of events) {
    const list = byUser.get(event.user_id) ?? [];
    list.push({ at: event.submitted_at.getTime(), probs: toNumbers(event.probs) });
    byUser.set(event.user_id, list);
  }

  const scores: UserScore[] = [];
  for (const [userId, forecasts] of byUser) {
    const result = timeAveragedScore({
      bucketCount: question.bucketCount,
      winningIndex,
      opensAt: question.opensAt.getTime(),
      closesAt: end.getTime(),
      forecasts,
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
  winningIndex: number,
  computedAt: Date,
): Promise<number> {
  const scores = await computeScores(db, question, winningIndex);
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
 * the submission log, and stretches where it was unpublished count as uniform.
 */
export async function aggregateScore(
  db: TournamentDb,
  question: QuestionRecord,
  winningIndex: number,
): Promise<ScoreResult | null> {
  const end = windowEnd(question);
  const rows = await db
    .selectFrom("tournament_aggregates")
    .select(["computed_at", "probs", "n_forecasters"])
    .where("question_id", "=", question.id)
    .where("computed_at", "<", end)
    .orderBy("computed_at")
    .orderBy("id")
    .execute();
  const uniform = new Array<number>(question.bucketCount).fill(1 / question.bucketCount);
  return timeAveragedScore({
    bucketCount: question.bucketCount,
    winningIndex,
    opensAt: question.opensAt.getTime(),
    closesAt: end.getTime(),
    forecasts: rows.map((row) => ({
      at: row.computed_at.getTime(),
      probs:
        row.n_forecasters >= MIN_PUBLISHED_FORECASTERS && row.probs !== null
          ? toNumbers(row.probs)
          : uniform,
    })),
  });
}
