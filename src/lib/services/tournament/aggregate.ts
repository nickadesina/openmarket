import {
  AGGREGATE_WEIGHTING_VERSION,
  aggregateForecasts,
} from "../../engine/tournament/aggregate.js";
import type { Bucket } from "../../engine/tournament/buckets.js";
import { deriveNumbers, type QuestionRecord, type TournamentDb, toNumbers } from "./records.js";

export interface LatestVector {
  readonly userId: string;
  readonly probs: number[];
  readonly submittedAt: Date;
}

/**
 * Each forecaster's latest vector submitted before `before`. Flagged
 * accounts are excluded unless `includeFlagged` (they are scored and shown,
 * but never move the aggregate).
 */
export async function latestVectors(
  db: TournamentDb,
  questionId: string,
  before: Date,
  options: { readonly includeFlagged?: boolean } = {},
): Promise<LatestVector[]> {
  let query = db
    .selectFrom("tournament_forecast_events as events")
    .innerJoin("tournament_users as users", "users.id", "events.user_id")
    .select(["events.user_id", "events.probs", "events.submitted_at"])
    .distinctOn("events.user_id")
    .where("events.question_id", "=", questionId)
    .where("events.submitted_at", "<", before);
  if (options.includeFlagged !== true) query = query.where("users.flagged", "=", false);
  const rows = await query
    .orderBy("events.user_id")
    .orderBy("events.submitted_at", "desc")
    .execute();
  return rows.map((row) => ({
    userId: row.user_id,
    probs: toNumbers(row.probs),
    submittedAt: row.submitted_at,
  }));
}

export interface AggregateComputation {
  readonly probs: number[] | null;
  readonly nForecasters: number;
}

export function computeAggregate(
  question: QuestionRecord,
  vectors: readonly LatestVector[],
): AggregateComputation {
  return {
    probs: aggregateForecasts(
      vectors.map((vector) => vector.probs),
      question.extremization,
    ),
    nForecasters: vectors.length,
  };
}

function optionalString(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * Recomputes the crowd distribution from every non-flagged forecaster's
 * latest vector and appends it as the live aggregate row. History is kept.
 */
export async function recomputeAggregate(
  db: TournamentDb,
  question: QuestionRecord,
  buckets: readonly Bucket[],
  computedAt: Date,
  windowEnd: Date,
): Promise<void> {
  // Events at or after the window end are kept but never counted.
  const cutoff =
    computedAt.getTime() < windowEnd.getTime() ? new Date(computedAt.getTime() + 1) : windowEnd;
  const { probs, nForecasters } = computeAggregate(
    question,
    await latestVectors(db, question.id, cutoff),
  );
  const derived = probs === null ? null : deriveNumbers(question.unit, buckets, probs);
  await db
    .insertInto("tournament_aggregates")
    .values({
      question_id: question.id,
      computed_at: computedAt,
      probs: probs?.map(String) ?? null,
      n_forecasters: nForecasters,
      median_value: optionalString(derived?.median?.value),
      p_floor: optionalString(derived?.pFloor),
      p_yes: optionalString(derived?.pYes),
      extremization: question.extremization,
      weighting_version: AGGREGATE_WEIGHTING_VERSION,
    })
    .execute();
}
