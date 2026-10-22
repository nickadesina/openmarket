import {
  AGGREGATE_WEIGHTING_VERSION,
  aggregateBinary,
  aggregateForward,
} from "../../engine/tournament/aggregate.js";
import type { ForecastPoint } from "../../engine/tournament/forecast.js";
import { type QuestionRecord, type TournamentDb, toForecastPoint } from "./records.js";

export interface LatestForecast extends ForecastPoint {
  readonly eventId: string;
  readonly userId: string;
  readonly submittedAt: Date;
}

/**
 * Each forecaster's latest forecast submitted before `before`, of the
 * question's kind (legacy events, which carry neither column, never count).
 * Flagged accounts are excluded unless `includeFlagged` (they are scored and
 * shown, but never move the aggregate).
 */
export async function latestForecasts(
  db: TournamentDb,
  question: Pick<QuestionRecord, "id" | "kind">,
  before: Date,
  options: { readonly includeFlagged?: boolean } = {},
): Promise<LatestForecast[]> {
  let query = db
    .selectFrom("tournament_forecast_events as events")
    .innerJoin("tournament_users as users", "users.id", "events.user_id")
    .select(["events.id", "events.user_id", "events.p", "events.value", "events.submitted_at"])
    .distinctOn("events.user_id")
    .where("events.question_id", "=", question.id)
    .where(question.kind === "binary" ? "events.p" : "events.value", "is not", null)
    .where("events.submitted_at", "<", before);
  if (options.includeFlagged !== true) query = query.where("users.flagged", "=", false);
  const rows = await query
    .orderBy("events.user_id")
    .orderBy("events.submitted_at", "desc")
    .execute();
  return rows.map((row) => ({
    eventId: row.id,
    userId: row.user_id,
    ...toForecastPoint(row),
    submittedAt: row.submitted_at,
  }));
}

export interface AggregateComputation {
  /** The crowd P(YES) or median level; both null with nobody on file. */
  readonly crowd: ForecastPoint;
  readonly nForecasters: number;
}

/** The crowd from each forecaster's latest forecast: pooled odds for a binary, the median ln level for a forward. */
export function computeAggregate(
  question: Pick<QuestionRecord, "kind" | "extremization">,
  forecasts: readonly ForecastPoint[],
): AggregateComputation {
  if (question.kind === "binary") {
    return {
      crowd: {
        p: aggregateBinary(
          forecasts.map((forecast) => forecast.p!),
          question.extremization,
        ),
        value: null,
      },
      nForecasters: forecasts.length,
    };
  }
  return {
    crowd: { p: null, value: aggregateForward(forecasts.map((forecast) => forecast.value!)) },
    nForecasters: forecasts.length,
  };
}

function optionalString(value: number | null): string | null {
  return value === null ? null : String(value);
}

/**
 * Recomputes the crowd from every non-flagged forecaster's latest forecast
 * and appends it as the live aggregate row. History is kept.
 */
export async function recomputeAggregate(
  db: TournamentDb,
  question: QuestionRecord,
  computedAt: Date,
  windowEnd: Date,
): Promise<void> {
  // Events at or after the window end are kept but never counted.
  const cutoff =
    computedAt.getTime() < windowEnd.getTime() ? new Date(computedAt.getTime() + 1) : windowEnd;
  const { crowd, nForecasters } = computeAggregate(
    question,
    await latestForecasts(db, question, cutoff),
  );
  await db
    .insertInto("tournament_aggregates")
    .values({
      question_id: question.id,
      computed_at: computedAt,
      n_forecasters: nForecasters,
      p: optionalString(crowd.p),
      value: optionalString(crowd.value),
      extremization: question.extremization,
      weighting_version: AGGREGATE_WEIGHTING_VERSION,
    })
    .execute();
}
