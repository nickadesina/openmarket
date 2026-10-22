import type { Kysely } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type { Database, TournamentQuestionStatus, TournamentUnit } from "../../db/schema.js";
import type { Bucket } from "../../engine/tournament/buckets.js";
import { type BucketMedian, bucketMedian } from "../../engine/tournament/median.js";
import { identitiesFor, userIdForHandle } from "./identities.js";
import {
  type AggregateView,
  effectiveStatus,
  latestAggregateRow,
  loadBuckets,
  nullableNumber,
  type PublicIdentity,
  type TournamentDb,
  toAggregateView,
  toNumbers,
  toQuestionRecord,
  windowEnd,
} from "./records.js";
import { restrictedCompanies } from "./restrictions.js";

export interface OpenPosition {
  readonly slug: string;
  readonly title: string;
  readonly unit: TournamentUnit;
  readonly status: TournamentQuestionStatus;
  readonly windowEndsAt: string;
  readonly buckets: readonly Bucket[];
  readonly probs: number[];
  readonly median: BucketMedian | null;
  readonly submissionCount: number;
  readonly lastUpdatedAt: string;
  readonly aggregate: AggregateView | null;
}

export interface ResolvedPosition {
  readonly slug: string;
  readonly title: string;
  readonly unit: TournamentUnit;
  readonly resolvedAt: string;
  readonly winningBucketIndex: number;
  readonly winningBucketLabel: string;
  readonly resolvedValue: number | null;
  readonly timeAvgLogScore: number;
  readonly finalLogScore: number;
  readonly coverage: number;
}

export interface ForecasterProfile {
  readonly identity: PublicIdentity;
  readonly open: OpenPosition[];
  readonly resolved: ResolvedPosition[];
  readonly totalScore: number;
}

async function positionsFor(db: TournamentDb, userId: string) {
  const questionRows = await db
    .selectFrom("tournament_questions")
    .selectAll()
    .where("status", "in", ["open", "closed", "resolved"])
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("tournament_forecast_events")
          .select("id")
          .whereRef("tournament_forecast_events.question_id", "=", "tournament_questions.id")
          .where("tournament_forecast_events.user_id", "=", userId),
      ),
    )
    .orderBy("closes_at", "asc")
    .execute();
  return questionRows.map(toQuestionRecord);
}

export async function getForecaster(
  db: Kysely<Database>,
  handle: string,
): Promise<ForecasterProfile> {
  const userId = await userIdForHandle(db, handle);
  const identity =
    userId === undefined ? undefined : (await identitiesFor(db, [userId])).get(userId);
  if (userId === undefined || identity === undefined) {
    throw new ServiceError("FORECASTER_NOT_FOUND", "No forecaster has that handle.");
  }

  const now = new Date();
  const open: OpenPosition[] = [];
  const resolved: ResolvedPosition[] = [];
  for (const question of await positionsFor(db, userId)) {
    const buckets = await loadBuckets(db, question.id);
    if (question.storedStatus === "resolved") {
      const score = await db
        .selectFrom("tournament_scores as scores")
        .innerJoin(
          "tournament_resolutions as resolutions",
          "resolutions.id",
          "scores.resolution_id",
        )
        .select([
          "scores.time_avg_log_score",
          "scores.final_log_score",
          "scores.coverage",
          "resolutions.resolved_at",
          "resolutions.winning_bucket_index",
          "resolutions.resolved_value",
        ])
        .where("scores.question_id", "=", question.id)
        .where("scores.user_id", "=", userId)
        .where("resolutions.superseded_by", "is", null)
        .executeTakeFirst();
      if (score === undefined) continue;
      resolved.push({
        slug: question.slug,
        title: question.title,
        unit: question.unit,
        resolvedAt: score.resolved_at.toISOString(),
        winningBucketIndex: score.winning_bucket_index,
        winningBucketLabel: buckets[score.winning_bucket_index]!.label,
        resolvedValue: nullableNumber(score.resolved_value),
        timeAvgLogScore: score.time_avg_log_score,
        finalLogScore: score.final_log_score,
        coverage: score.coverage,
      });
      continue;
    }

    const events = await db
      .selectFrom("tournament_forecast_events")
      .select(["probs", "submitted_at"])
      .where("question_id", "=", question.id)
      .where("user_id", "=", userId)
      .where("submitted_at", "<", windowEnd(question))
      .orderBy("submitted_at", "desc")
      .execute();
    const latest = events[0];
    if (latest === undefined) continue;
    const probs = toNumbers(latest.probs);
    const aggregate = await latestAggregateRow(db, question.id);
    open.push({
      slug: question.slug,
      title: question.title,
      unit: question.unit,
      status: effectiveStatus(question, now),
      windowEndsAt: windowEnd(question).toISOString(),
      buckets,
      probs,
      median: question.unit === "bool" ? null : bucketMedian(buckets, probs),
      submissionCount: events.length,
      lastUpdatedAt: latest.submitted_at.toISOString(),
      aggregate:
        aggregate === undefined ? null : toAggregateView(aggregate, question.unit, buckets),
    });
  }

  resolved.sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt));
  return {
    identity,
    open,
    resolved,
    totalScore: resolved.reduce((sum, position) => sum + position.timeAvgLogScore, 0),
  };
}

export interface ViewerForecast {
  readonly probs: number[];
  readonly submittedAt: string;
  readonly submissionCount: number;
}

export interface Viewer {
  readonly identity: PublicIdentity;
  /** The viewer's latest vector per question slug. */
  readonly forecasts: Readonly<Record<string, ViewerForecast>>;
  /** True until the viewer's first submission anywhere: the UI discloses that forecasts are public. */
  readonly firstSubmission: boolean;
  /** Listed names the viewer attested a tie to; their tickets are hidden and trades refused. */
  readonly restrictedCompanySlugs: readonly string[];
}

export async function getViewer(db: Kysely<Database>, userId: string): Promise<Viewer | null> {
  const identity = (await identitiesFor(db, [userId])).get(userId);
  if (identity === undefined) return null;
  const rows = await db
    .selectFrom("tournament_forecast_events as events")
    .innerJoin("tournament_questions as questions", "questions.id", "events.question_id")
    .select(["questions.slug", "events.probs", "events.submitted_at"])
    .where("events.user_id", "=", userId)
    .orderBy("questions.slug")
    .orderBy("events.submitted_at", "desc")
    .execute();
  const forecasts: Record<string, ViewerForecast> = {};
  for (const row of rows) {
    const existing = forecasts[row.slug];
    forecasts[row.slug] =
      existing === undefined
        ? {
            probs: toNumbers(row.probs),
            submittedAt: row.submitted_at.toISOString(),
            submissionCount: 1,
          }
        : { ...existing, submissionCount: existing.submissionCount + 1 };
  }
  const restricted = await restrictedCompanies(db, userId);
  return {
    identity,
    forecasts,
    firstSubmission: rows.length === 0,
    restrictedCompanySlugs: restricted.map((company) => company.slug),
  };
}
