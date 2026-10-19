import type { Kysely } from "kysely";

import { DISPUTE_WINDOW_MS } from "../../config/tournament.js";
import type { Database, TournamentQuestionStatus, TournamentUnit } from "../../db/schema.js";
import {
  AGGREGATE_WEIGHTING_VERSION,
  MIN_PUBLISHED_FORECASTERS,
} from "../../engine/tournament/aggregate.js";
import type { Bucket } from "../../engine/tournament/buckets.js";
import {
  clampedFloorScore,
  SCORE_EPSILON,
  type ScoreResult,
} from "../../engine/tournament/score.js";
import { computeAggregate, latestVectors } from "./aggregate.js";
import { identitiesFor } from "./identities.js";
import {
  type AggregateView,
  acceptingForecasts,
  deriveNumbers,
  effectiveStatus,
  latestAggregateRow,
  loadBuckets,
  nullableNumber,
  type PublicIdentity,
  type QuestionRecord,
  requireQuestion,
  type TournamentDb,
  toAggregateView,
  toQuestionRecord,
  windowEnd,
} from "./records.js";
import { aggregateScore } from "./scoring.js";

export interface QuestionSummary {
  readonly slug: string;
  readonly title: string;
  readonly unit: TournamentUnit;
  readonly status: TournamentQuestionStatus;
  readonly acceptingForecasts: boolean;
  readonly opensAt: string;
  readonly closesAt: string;
  /** closes_at, or the earlier manual close when the document arrived first. */
  readonly windowEndsAt: string;
  readonly expiryAt: string;
  readonly buckets: readonly Bucket[];
  readonly aggregate: AggregateView | null;
  readonly resolution: {
    readonly winningBucketIndex: number;
    readonly resolvedValue: number | null;
    readonly resolvedAt: string;
  } | null;
}

export interface ResolutionDetail {
  readonly resolvedAt: string;
  readonly winningBucketIndex: number;
  readonly resolvedValue: number | null;
  readonly rungFired: number | null;
  readonly sourceUrl: string | null;
  readonly sourceExcerpt: string | null;
  readonly noteMd: string;
  readonly disputeWindowEndsAt: string;
  /** Earlier resolutions this one replaced inside the dispute window. */
  readonly supersededCount: number;
  readonly notes: readonly { readonly createdAt: string; readonly noteMd: string }[];
  /** The aggregate as it stood at the window end. */
  readonly finalAggregate: AggregateView | null;
  /** The published aggregate scored as one more forecaster. */
  readonly aggregateScore: ScoreResult | null;
  readonly topForecasters: readonly ScoredForecaster[];
}

export interface ScoredForecaster extends PublicIdentity {
  readonly timeAvgLogScore: number;
  readonly finalLogScore: number;
  readonly coverage: number;
}

export interface ScoringRules {
  readonly epsilon: number;
  /** The score of a stretch spent at 0 on the winning bucket. */
  readonly clampScore: number;
  readonly extremization: number;
  readonly weightingVersion: string;
  readonly minPublishedForecasters: number;
}

export interface QuestionDetail extends QuestionSummary {
  readonly descriptionMd: string;
  readonly rulebookMd: string;
  readonly rulebookVersion: number;
  readonly minAccountAgeDays: number;
  readonly xThreadUrl: string | null;
  readonly voidNoteMd: string | null;
  readonly closedAt: string | null;
  readonly resolutionDetail: ResolutionDetail | null;
  readonly rules: ScoringRules;
}

async function liveResolutions(db: TournamentDb, questionIds: readonly string[]) {
  if (questionIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("tournament_resolutions")
    .selectAll()
    .where("question_id", "in", questionIds)
    .where("superseded_by", "is", null)
    .execute();
  return new Map(rows.map((row) => [row.question_id, row]));
}

async function summarize(
  db: TournamentDb,
  question: QuestionRecord,
  buckets: readonly Bucket[],
  now: Date,
  resolution:
    | { winning_bucket_index: number; resolved_value: string | null; resolved_at: Date }
    | undefined,
): Promise<QuestionSummary> {
  const aggregate = await latestAggregateRow(db, question.id);
  return {
    slug: question.slug,
    title: question.title,
    unit: question.unit,
    status: effectiveStatus(question, now),
    acceptingForecasts: acceptingForecasts(question, now),
    opensAt: question.opensAt.toISOString(),
    closesAt: question.closesAt.toISOString(),
    windowEndsAt: windowEnd(question).toISOString(),
    expiryAt: question.expiryAt.toISOString(),
    buckets,
    aggregate: aggregate === undefined ? null : toAggregateView(aggregate, question.unit, buckets),
    resolution:
      resolution === undefined
        ? null
        : {
            winningBucketIndex: resolution.winning_bucket_index,
            resolvedValue: nullableNumber(resolution.resolved_value),
            resolvedAt: resolution.resolved_at.toISOString(),
          },
  };
}

/** Every public question, open ones first, then by close. Drafts are excluded. */
export async function listQuestions(db: Kysely<Database>): Promise<QuestionSummary[]> {
  const rows = await db
    .selectFrom("tournament_questions")
    .selectAll()
    .where("status", "<>", "draft")
    .orderBy("closes_at", "asc")
    .orderBy("slug", "asc")
    .execute();
  const now = new Date();
  const resolutions = await liveResolutions(
    db,
    rows.map((row) => row.id),
  );
  const summaries: QuestionSummary[] = [];
  for (const row of rows) {
    const question = toQuestionRecord(row);
    summaries.push(
      await summarize(
        db,
        question,
        await loadBuckets(db, question.id),
        now,
        resolutions.get(row.id),
      ),
    );
  }
  const order: Record<TournamentQuestionStatus, number> = {
    open: 0,
    closed: 1,
    resolved: 2,
    voided: 3,
    draft: 4,
  };
  return summaries.sort((left, right) => order[left.status] - order[right.status]);
}

/** The aggregate recomputed from the event log at the window end, masked below the minimum. */
async function finalAggregate(
  db: TournamentDb,
  question: QuestionRecord,
  buckets: readonly Bucket[],
): Promise<AggregateView | null> {
  const end = windowEnd(question);
  const { probs, nForecasters } = computeAggregate(
    question,
    await latestVectors(db, question.id, end),
  );
  if (probs === null) return null;
  const published = nForecasters >= MIN_PUBLISHED_FORECASTERS;
  const derived = deriveNumbers(question.unit, buckets, probs);
  return {
    computedAt: end.toISOString(),
    nForecasters,
    published,
    probs: published ? probs : null,
    medianValue: published ? (derived.median?.value ?? null) : null,
    medianPosition: published ? (derived.median?.position ?? null) : null,
    pFloor: published ? derived.pFloor : null,
    pYes: published ? derived.pYes : null,
    extremization: question.extremization,
    weightingVersion: AGGREGATE_WEIGHTING_VERSION,
  };
}

export async function scoredForecasters(
  db: TournamentDb,
  resolutionId: string,
  limit?: number,
): Promise<ScoredForecaster[]> {
  let query = db
    .selectFrom("tournament_scores")
    .selectAll()
    .where("resolution_id", "=", resolutionId)
    .orderBy("time_avg_log_score", "desc")
    .orderBy("coverage", "desc")
    .orderBy("user_id");
  if (limit !== undefined) query = query.limit(limit);
  const scores = await query.execute();
  const identities = await identitiesFor(
    db,
    scores.map((score) => score.user_id),
  );
  return scores.flatMap((score) => {
    const identity = identities.get(score.user_id);
    return identity === undefined
      ? []
      : [
          {
            ...identity,
            timeAvgLogScore: score.time_avg_log_score,
            finalLogScore: score.final_log_score,
            coverage: score.coverage,
          },
        ];
  });
}

async function resolutionDetail(
  db: TournamentDb,
  question: QuestionRecord,
  buckets: readonly Bucket[],
): Promise<ResolutionDetail | null> {
  const resolutions = await db
    .selectFrom("tournament_resolutions")
    .selectAll()
    .where("question_id", "=", question.id)
    .orderBy("resolved_at", "asc")
    .execute();
  const live = resolutions.find((row) => row.superseded_by === null);
  if (live === undefined) return null;
  const notes = await db
    .selectFrom("tournament_resolution_notes")
    .select(["created_at", "note_md"])
    .where("question_id", "=", question.id)
    .orderBy("created_at", "asc")
    .execute();
  return {
    resolvedAt: live.resolved_at.toISOString(),
    winningBucketIndex: live.winning_bucket_index,
    resolvedValue: nullableNumber(live.resolved_value),
    rungFired: live.rung_fired,
    sourceUrl: live.source_url,
    sourceExcerpt: live.source_excerpt,
    noteMd: live.note_md,
    disputeWindowEndsAt: new Date(
      resolutions[0]!.resolved_at.getTime() + DISPUTE_WINDOW_MS,
    ).toISOString(),
    supersededCount: resolutions.length - 1,
    notes: notes.map((note) => ({
      createdAt: note.created_at.toISOString(),
      noteMd: note.note_md,
    })),
    finalAggregate: await finalAggregate(db, question, buckets),
    aggregateScore: await aggregateScore(db, question, live.winning_bucket_index),
    topForecasters: await scoredForecasters(db, live.id, 10),
  };
}

export async function getQuestion(db: Kysely<Database>, slug: string): Promise<QuestionDetail> {
  const question = await requireQuestion(db, slug);
  const buckets = await loadBuckets(db, question.id);
  const resolutions = await liveResolutions(db, [question.id]);
  const summary = await summarize(db, question, buckets, new Date(), resolutions.get(question.id));
  return {
    ...summary,
    descriptionMd: question.descriptionMd,
    rulebookMd: question.rulebookMd,
    rulebookVersion: question.rulebookVersion,
    minAccountAgeDays: question.minAccountAgeDays,
    xThreadUrl: question.xThreadUrl,
    voidNoteMd: question.voidNoteMd,
    closedAt: question.closedAt?.toISOString() ?? null,
    resolutionDetail:
      question.storedStatus === "resolved" ? await resolutionDetail(db, question, buckets) : null,
    rules: {
      epsilon: SCORE_EPSILON,
      clampScore: clampedFloorScore(question.bucketCount),
      extremization: question.extremization,
      weightingVersion: AGGREGATE_WEIGHTING_VERSION,
      minPublishedForecasters: MIN_PUBLISHED_FORECASTERS,
    },
  };
}

export interface PublicForecast extends PublicIdentity {
  readonly probs: number[];
  readonly submittedAt: string;
  readonly submissionCount: number;
}

/**
 * Every forecaster's vector in force at the window end (their latest, unless
 * a back-dated close left later events uncounted). Flagged accounts are
 * included and marked.
 */
export async function listLatestForecasts(
  db: Kysely<Database>,
  slug: string,
): Promise<{ readonly slug: string; readonly forecasts: PublicForecast[] }> {
  const question = await requireQuestion(db, slug);
  const latest = await latestVectors(db, question.id, windowEnd(question), {
    includeFlagged: true,
  });
  const counts = await db
    .selectFrom("tournament_forecast_events")
    .select(["user_id", db.fn.countAll<string>().as("count")])
    .where("question_id", "=", question.id)
    .where("submitted_at", "<", windowEnd(question))
    .groupBy("user_id")
    .execute();
  const countByUser = new Map(counts.map((row) => [row.user_id, Number(row.count)]));
  const identities = await identitiesFor(
    db,
    latest.map((vector) => vector.userId),
  );
  const forecasts = latest
    .flatMap((vector) => {
      const identity = identities.get(vector.userId);
      return identity === undefined
        ? []
        : [
            {
              ...identity,
              probs: vector.probs,
              submittedAt: vector.submittedAt.toISOString(),
              submissionCount: countByUser.get(vector.userId) ?? 0,
            },
          ];
    })
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  return { slug, forecasts };
}

export async function aggregateHistory(
  db: Kysely<Database>,
  slug: string,
): Promise<{ readonly slug: string; readonly history: AggregateView[] }> {
  const question = await requireQuestion(db, slug);
  const buckets = await loadBuckets(db, question.id);
  const rows = await db
    .selectFrom("tournament_aggregates")
    .selectAll()
    .where("question_id", "=", question.id)
    .orderBy("computed_at", "asc")
    .orderBy("id", "asc")
    .execute();
  return {
    slug,
    history: rows.map((row) => toAggregateView(row, question.unit, buckets)),
  };
}
