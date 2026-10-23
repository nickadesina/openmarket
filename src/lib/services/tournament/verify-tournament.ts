import { type Kysely, sql } from "kysely";

import type { Database } from "../../db/schema.js";
import type { ForecastPoint } from "../../engine/tournament/forecast.js";
import { computeAggregate, latestForecasts } from "./aggregate.js";
import { buildMerkleTree, merkleRootFromPath } from "./merkle.js";
import { BATCH_GRACE_MS } from "./provenance.js";
import {
  effectiveStatus,
  type QuestionRecord,
  toForecastPoint,
  toNumbers,
  toQuestionRecord,
  windowEnd,
} from "./records.js";
import { computeScores, resolvedAs } from "./scoring.js";
import { forecastEventHash } from "./submit-forecast.js";

const TOLERANCE = 1e-9;

export interface TournamentFinding {
  readonly slug: string;
  readonly check:
    | "event_shape"
    | "event_hash"
    | "live_resolution"
    | "scores"
    | "aggregate"
    | "provenance";
  readonly detail: string;
}

export interface TournamentVerification {
  readonly questionsChecked: number;
  readonly eventsChecked: number;
  readonly batchesChecked: number;
  readonly findings: TournamentFinding[];
  /**
   * Provenance gaps that do not fail replay: a completed hour the hourly job
   * has not batched yet (cron lag), or an event committed after its hour was
   * batched (batches are immutable, so it can never be added). Both are
   * reported, never fatal, so they cannot block a deploy.
   */
  readonly warnings: TournamentFinding[];
  readonly passed: boolean;
}

type Fail = (check: TournamentFinding["check"], detail: string) => void;

/** Why a stored event is malformed for its question, or null when it is well formed. */
function eventShapeProblem(
  question: QuestionRecord,
  forecast: ForecastPoint,
  archived: readonly number[] | null,
): string | null {
  const { p, value } = forecast;
  if (p === null && value === null) {
    if (archived === null) return "is legacy (no p or value) with no archived vector";
    const sum = archived.reduce((total, probability) => total + probability, 0);
    const valid = archived.length >= 2 && archived.every((probability) => probability >= 0);
    return valid && Math.abs(sum - 1) <= 1e-6
      ? null
      : `has an archived vector of ${archived.length} entries summing to ${sum}`;
  }
  if (archived !== null) return "carries a forecast and an archived vector";
  if (question.kind === "binary") {
    return p !== null && value === null && p > 0 && p < 1 ? null : `is not one P(YES) (p ${p})`;
  }
  return value !== null && p === null && value > 0 ? null : `is not one level (value ${value})`;
}

/**
 * Each event's shape for its question's kind (legacy events by their
 * archived vector), and its stored hash against a recomputation.
 */
async function checkEvents(
  db: Kysely<Database>,
  question: QuestionRecord,
  fail: Fail,
): Promise<number> {
  const events = await db
    .selectFrom("tournament_forecast_events as events")
    .leftJoin("tournament_archived_forecast_vectors as archived", "archived.event_id", "events.id")
    .select([
      "events.id",
      "events.user_id",
      "events.submitted_at",
      "events.p",
      "events.value",
      "events.event_hash",
      "archived.probs as archived_probs",
    ])
    .where("events.question_id", "=", question.id)
    .execute();
  for (const event of events) {
    const forecast = toForecastPoint(event);
    const archived = event.archived_probs === null ? null : toNumbers(event.archived_probs);
    const problem = eventShapeProblem(question, forecast, archived);
    if (problem !== null) {
      fail("event_shape", `event ${event.id} ${problem}`);
      continue;
    }
    const recomputed = forecastEventHash(question.id, event.user_id, event.submitted_at, {
      ...forecast,
      archivedProbs: archived,
    });
    if (recomputed !== event.event_hash) {
      fail("event_hash", `event ${event.id} does not hash to its stored event_hash`);
    }
  }
  return events.length;
}

async function checkScores(
  db: Kysely<Database>,
  question: QuestionRecord,
  fail: Fail,
): Promise<void> {
  const live = await db
    .selectFrom("tournament_resolutions")
    .selectAll()
    .where("question_id", "=", question.id)
    .where("superseded_by", "is", null)
    .execute();
  if ((question.storedStatus === "resolved") !== (live.length === 1)) {
    fail("live_resolution", `${question.storedStatus} with ${live.length} live resolutions`);
  }
  // A resolution naming itself was superseded by a void.
  const voidedOver = await db
    .selectFrom("tournament_resolutions")
    .select("id")
    .where("question_id", "=", question.id)
    .whereRef("superseded_by", "=", "id")
    .execute();
  if (voidedOver.length > 0 && question.storedStatus !== "voided") {
    fail("live_resolution", `${question.storedStatus} with a resolution superseded by a void`);
  }
  const resolution = live[0];
  if (resolution === undefined || question.storedStatus !== "resolved") return;
  if ((question.kind === "binary") !== (resolution.outcome !== null)) {
    fail("live_resolution", `a ${question.kind} resolved with the other kind's field`);
    return;
  }

  const expected = await computeScores(db, question, resolvedAs(resolution));
  const stored = await db
    .selectFrom("tournament_scores")
    .selectAll()
    .where("resolution_id", "=", resolution.id)
    .execute();
  const storedByUser = new Map(stored.map((score) => [score.user_id, score]));
  if (stored.length !== expected.length) {
    fail("scores", `${stored.length} stored scores, ${expected.length} recomputed`);
  }
  for (const score of expected) {
    const match = storedByUser.get(score.userId);
    const close =
      match !== undefined &&
      Math.abs(match.time_avg_log_score - score.timeAvgLogScore) <= TOLERANCE &&
      Math.abs(match.final_log_score - score.finalLogScore) <= TOLERANCE &&
      Math.abs(match.coverage - score.coverage) <= TOLERANCE;
    if (!close) fail("scores", `user ${score.userId} does not match the recomputed score`);
  }
}

function sameFigure(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= TOLERANCE * Math.max(1, Math.abs(right));
}

async function checkAggregate(
  db: Kysely<Database>,
  question: QuestionRecord,
  fail: Fail,
): Promise<void> {
  const latest = await db
    .selectFrom("tournament_aggregates")
    .selectAll()
    .where("question_id", "=", question.id)
    .orderBy("computed_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (latest === undefined) return;
  const end = windowEnd(question);
  const cutoff = latest.computed_at < end ? new Date(latest.computed_at.getTime() + 1) : end;
  const recomputed = computeAggregate(question, await latestForecasts(db, question, cutoff));
  const stored = toForecastPoint(latest);
  if (
    recomputed.nForecasters !== latest.n_forecasters ||
    !sameFigure(stored.p, recomputed.crowd.p) ||
    !sameFigure(stored.value, recomputed.crowd.value)
  ) {
    fail("aggregate", "the live aggregate does not match a recomputation");
  }
}

/**
 * Every provenance batch must re-derive: its leaves, in order, rebuild the
 * committed root, and each stored path folds its event hash to that root.
 * Events outside any batch are warnings (see `TournamentVerification`).
 */
async function checkProvenance(db: Kysely<Database>, fail: Fail, warn: Fail): Promise<number> {
  const batches = await db
    .selectFrom("tournament_provenance_batches")
    .select(["id", "root", "leaf_count", "hour_start"])
    .orderBy("hour_start")
    .execute();
  const missing = await db
    .selectFrom("tournament_forecast_events as events")
    .leftJoin("tournament_provenance_leaves as leaves", "leaves.event_id", "events.id")
    .leftJoin("tournament_provenance_batches as batches", (join) =>
      join.onRef("batches.hour_start", "=", sql<Date>`date_trunc('hour', events.submitted_at)`),
    )
    .select(["events.id", "batches.id as batch_id"])
    .where("leaves.event_id", "is", null)
    .where(({ or, eb }) =>
      or([
        eb("batches.id", "is not", null),
        sql<boolean>`date_trunc('hour', events.submitted_at) + interval '1 hour' <= clock_timestamp() - ${`${BATCH_GRACE_MS} milliseconds`}::interval`,
      ]),
    )
    .execute();
  for (const event of missing) {
    warn(
      "provenance",
      event.batch_id === null
        ? `event ${event.id}'s completed hour has no batch`
        : `event ${event.id} is missing from batch ${event.batch_id}`,
    );
  }
  for (const batch of batches) {
    const leaves = await db
      .selectFrom("tournament_provenance_leaves as leaves")
      .innerJoin("tournament_forecast_events as events", "events.id", "leaves.event_id")
      .select(["leaves.leaf_index", "leaves.path", "events.event_hash", "events.submitted_at"])
      .where("leaves.batch_id", "=", batch.id)
      .orderBy("leaves.leaf_index")
      .execute();
    const hour = batch.hour_start.toISOString();
    if (
      leaves.length !== batch.leaf_count ||
      leaves.length === 0 ||
      buildMerkleTree(leaves.map((leaf) => leaf.event_hash)).root !== batch.root
    ) {
      fail("provenance", `batch ${hour} does not rebuild its root`);
      continue;
    }
    for (const leaf of leaves) {
      if (
        leaf.submitted_at < batch.hour_start ||
        leaf.submitted_at.getTime() >= batch.hour_start.getTime() + 60 * 60_000
      ) {
        fail("provenance", `batch ${hour} leaf ${leaf.leaf_index} belongs to a different hour`);
      }
      if (merkleRootFromPath(leaf.event_hash, leaf.path) !== batch.root) {
        fail("provenance", `batch ${hour} leaf ${leaf.leaf_index} path does not fold to the root`);
      }
    }
  }
  return batches.length;
}

/**
 * Recomputes the tournament's derived state from its system of record
 * (forecast events and resolutions): every event hash recomputes from its
 * payload (a legacy event's from its archived vector), stored scores must
 * match the scorer, and every open question's live aggregate must match the
 * aggregator.
 */
export async function verifyTournament(db: Kysely<Database>): Promise<TournamentVerification> {
  const findings: TournamentFinding[] = [];
  const rows = await db.selectFrom("tournament_questions").selectAll().orderBy("slug").execute();
  const now = new Date();
  let eventsChecked = 0;

  for (const row of rows) {
    const question = toQuestionRecord(row);
    const fail: Fail = (check, detail) => findings.push({ slug: question.slug, check, detail });
    eventsChecked += await checkEvents(db, question, fail);
    await checkScores(db, question, fail);
    // Closed questions keep the aggregate they closed with even if a flag changes later.
    if (effectiveStatus(question, now) === "open") await checkAggregate(db, question, fail);
  }

  const warnings: TournamentFinding[] = [];
  const batchesChecked = await checkProvenance(
    db,
    (check, detail) => findings.push({ slug: "(provenance)", check, detail }),
    (check, detail) => warnings.push({ slug: "(provenance)", check, detail }),
  );

  return {
    questionsChecked: rows.length,
    eventsChecked,
    batchesChecked,
    findings,
    warnings,
    passed: findings.length === 0,
  };
}
