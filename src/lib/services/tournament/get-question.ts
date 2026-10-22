import type { Kysely, Selectable } from "kysely";

import { DISPUTE_WINDOW_MS } from "../../config/tournament.js";
import type {
  Database,
  TournamentQuestionKind,
  TournamentQuestionStatus,
  TournamentResolutionsTable,
  TournamentUnit,
} from "../../db/schema.js";
import {
  AGGREGATE_WEIGHTING_VERSION,
  MIN_PUBLISHED_FORECASTERS,
} from "../../engine/tournament/aggregate.js";
import { CLAMP_SCORE, SCORE_EPSILON, type ScoreResult } from "../../engine/tournament/score.js";
import { computeAggregate, latestForecasts } from "./aggregate.js";
import { identitiesFor } from "./identities.js";
import {
  type AggregateView,
  acceptingForecasts,
  aggregateView,
  effectiveStatus,
  latestAggregateRow,
  nullableNumber,
  type PublicIdentity,
  type QuestionRecord,
  requireQuestion,
  type TournamentDb,
  toAggregateView,
  toQuestionRecord,
  windowEnd,
} from "./records.js";
import { aggregateScore, resolvedAs } from "./scoring.js";

/** The dealer instrument a linked question follows, with its latest price. */
export interface LinkedInstrument {
  readonly kind: TournamentQuestionKind;
  readonly companySlug: string;
  /** A binary's latest YES price. */
  readonly yesPrice: number | null;
  /** A forward's latest dealer mid, in USD. */
  readonly midUsd: number | null;
}

export interface QuestionSummary {
  readonly slug: string;
  readonly title: string;
  readonly kind: TournamentQuestionKind;
  /** A forward's unit; null for a binary. */
  readonly unit: TournamentUnit | null;
  /** A forward's short name for its level; null for a binary or when none was given. */
  readonly levelLabel: string | null;
  readonly status: TournamentQuestionStatus;
  readonly acceptingForecasts: boolean;
  readonly opensAt: string;
  readonly closesAt: string;
  /** closes_at, or the earlier manual close when the document arrived first. */
  readonly windowEndsAt: string;
  readonly expiryAt: string;
  readonly aggregate: AggregateView | null;
  readonly resolution: {
    /** A binary's outcome; null for a forward. */
    readonly outcome: "yes" | "no" | null;
    /** A forward's settling value in its unit; null for a binary. */
    readonly resolvedValue: number | null;
    readonly resolvedAt: string;
  } | null;
  /** The dealer instrument a linked question follows; null for a hand-written question. */
  readonly instrument: LinkedInstrument | null;
}

export interface ResolutionDetail {
  readonly resolvedAt: string;
  readonly outcome: "yes" | "no" | null;
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
  /** The lowest score a forecast can take: the binary at ε, the forward's floor. */
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

type ResolutionRow = Selectable<TournamentResolutionsTable>;

async function liveResolutions(
  db: TournamentDb,
  questionIds: readonly string[],
): Promise<Map<string, ResolutionRow>> {
  if (questionIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("tournament_resolutions")
    .selectAll()
    .where("question_id", "in", questionIds)
    .where("superseded_by", "is", null)
    .execute();
  return new Map(rows.map((row) => [row.question_id, row]));
}

/**
 * Each linked question's instrument with its latest price: the latest quote,
 * else the latest model mid. Read from the dealer's tables, never written.
 */
async function linkedInstruments(
  db: TournamentDb,
  questionIds: readonly string[],
): Promise<Map<string, LinkedInstrument>> {
  if (questionIds.length === 0) return new Map();
  const links = await db
    .selectFrom("tournament_instrument_links as links")
    .innerJoin("instruments", "instruments.id", "links.instrument_id")
    .innerJoin("listings", "listings.id", "instruments.listing_id")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .select([
      "links.question_id",
      "instruments.id as instrument_id",
      "instruments.kind",
      "companies.slug as company_slug",
    ])
    .where("links.question_id", "in", questionIds)
    .execute();
  if (links.length === 0) return new Map();
  const instrumentIds = links.map((link) => link.instrument_id);
  const quotes = await db
    .selectFrom("quotes")
    .select(["instrument_id", "price", "mid_ln"])
    .distinctOn("instrument_id")
    .where("instrument_id", "in", instrumentIds)
    .orderBy("instrument_id")
    .orderBy("posted_at", "desc")
    .orderBy("sequence", "desc")
    .execute();
  const mids = await db
    .selectFrom("model_mids")
    .select(["instrument_id", "p", "mid_ln"])
    .distinctOn("instrument_id")
    .where("instrument_id", "in", instrumentIds)
    .orderBy("instrument_id")
    .orderBy("computed_at", "desc")
    .orderBy("id", "desc")
    .execute();
  const quoteBy = new Map(quotes.map((quote) => [quote.instrument_id, quote]));
  const midBy = new Map(mids.map((mid) => [mid.instrument_id, mid]));
  return new Map(
    links.map((link) => {
      const quote = quoteBy.get(link.instrument_id);
      const mid = midBy.get(link.instrument_id);
      const midLn = quote?.mid_ln ?? mid?.mid_ln ?? null;
      return [
        link.question_id,
        {
          kind: link.kind,
          companySlug: link.company_slug,
          yesPrice: link.kind === "binary" ? (quote?.price ?? mid?.p ?? null) : null,
          midUsd: link.kind === "forward" && midLn !== null ? Math.exp(midLn) : null,
        },
      ];
    }),
  );
}

async function summarize(
  db: TournamentDb,
  question: QuestionRecord,
  now: Date,
  resolution: ResolutionRow | undefined,
  instrument: LinkedInstrument | undefined,
): Promise<QuestionSummary> {
  const aggregate = await latestAggregateRow(db, question.id);
  return {
    slug: question.slug,
    title: question.title,
    kind: question.kind,
    unit: question.unit,
    levelLabel: question.levelLabel,
    status: effectiveStatus(question, now),
    acceptingForecasts: acceptingForecasts(question, now),
    opensAt: question.opensAt.toISOString(),
    closesAt: question.closesAt.toISOString(),
    windowEndsAt: windowEnd(question).toISOString(),
    expiryAt: question.expiryAt.toISOString(),
    aggregate: aggregate === undefined ? null : toAggregateView(aggregate),
    resolution:
      resolution === undefined
        ? null
        : {
            outcome: resolution.outcome,
            resolvedValue: nullableNumber(resolution.resolved_value),
            resolvedAt: resolution.resolved_at.toISOString(),
          },
    instrument: instrument ?? null,
  };
}

/**
 * The board: every public question, open ones first, then by close. Drafts
 * and voided questions are left off; a voided question keeps its page at
 * /t/q/[slug] for its note and its forecasts' proofs.
 */
export async function listQuestions(db: Kysely<Database>): Promise<QuestionSummary[]> {
  const rows = await db
    .selectFrom("tournament_questions")
    .selectAll()
    .where("status", "not in", ["draft", "voided"])
    .orderBy("closes_at", "asc")
    .orderBy("slug", "asc")
    .execute();
  const now = new Date();
  const ids = rows.map((row) => row.id);
  const resolutions = await liveResolutions(db, ids);
  const instruments = await linkedInstruments(db, ids);
  const summaries: QuestionSummary[] = [];
  for (const row of rows) {
    summaries.push(
      await summarize(
        db,
        toQuestionRecord(row),
        now,
        resolutions.get(row.id),
        instruments.get(row.id),
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
): Promise<AggregateView | null> {
  const end = windowEnd(question);
  const { crowd, nForecasters } = computeAggregate(
    question,
    await latestForecasts(db, question, end),
  );
  if (nForecasters === 0) return null;
  return aggregateView(end, nForecasters, crowd);
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
    outcome: live.outcome,
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
    finalAggregate: await finalAggregate(db, question),
    aggregateScore: await aggregateScore(db, question, resolvedAs(live)),
    topForecasters: await scoredForecasters(db, live.id, 10),
  };
}

export async function getQuestion(db: Kysely<Database>, slug: string): Promise<QuestionDetail> {
  const question = await requireQuestion(db, slug);
  const resolutions = await liveResolutions(db, [question.id]);
  const instruments = await linkedInstruments(db, [question.id]);
  const summary = await summarize(
    db,
    question,
    new Date(),
    resolutions.get(question.id),
    instruments.get(question.id),
  );
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
      question.storedStatus === "resolved" ? await resolutionDetail(db, question) : null,
    rules: {
      epsilon: SCORE_EPSILON,
      clampScore: CLAMP_SCORE,
      extremization: question.extremization,
      weightingVersion: AGGREGATE_WEIGHTING_VERSION,
      minPublishedForecasters: MIN_PUBLISHED_FORECASTERS,
    },
  };
}

export interface PublicForecast extends PublicIdentity {
  /** The event in force; its provenance proof lives at /t/provenance/[eventId]. */
  readonly eventId: string;
  /** A binary forecast's P(YES); null for a forward. */
  readonly p: number | null;
  /** A forward forecast's level in the question's unit; null for a binary. */
  readonly value: number | null;
  readonly submittedAt: string;
  readonly submissionCount: number;
}

/**
 * Every forecaster's forecast in force at the window end (their latest,
 * unless a back-dated close left later events uncounted). Flagged accounts
 * are included and marked. Legacy (pre-013) events are not forecasts in
 * force; their proofs stay at /t/provenance/[eventId].
 */
export async function listLatestForecasts(
  db: Kysely<Database>,
  slug: string,
): Promise<{ readonly slug: string; readonly forecasts: PublicForecast[] }> {
  const question = await requireQuestion(db, slug);
  const latest = await latestForecasts(db, question, windowEnd(question), {
    includeFlagged: true,
  });
  const counts = await db
    .selectFrom("tournament_forecast_events")
    .select(["user_id", db.fn.countAll<string>().as("count")])
    .where("question_id", "=", question.id)
    .where(question.kind === "binary" ? "p" : "value", "is not", null)
    .where("submitted_at", "<", windowEnd(question))
    .groupBy("user_id")
    .execute();
  const countByUser = new Map(counts.map((row) => [row.user_id, Number(row.count)]));
  const identities = await identitiesFor(
    db,
    latest.map((forecast) => forecast.userId),
  );
  const forecasts = latest
    .flatMap((forecast) => {
      const identity = identities.get(forecast.userId);
      return identity === undefined
        ? []
        : [
            {
              ...identity,
              eventId: forecast.eventId,
              p: forecast.p,
              value: forecast.value,
              submittedAt: forecast.submittedAt.toISOString(),
              submissionCount: countByUser.get(forecast.userId) ?? 0,
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
  const rows = await db
    .selectFrom("tournament_aggregates")
    .selectAll()
    .where("question_id", "=", question.id)
    .orderBy("computed_at", "asc")
    .orderBy("id", "asc")
    .execute();
  return { slug, history: rows.map(toAggregateView) };
}
