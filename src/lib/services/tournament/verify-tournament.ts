import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import { computeAggregate, latestVectors } from "./aggregate.js";
import {
  effectiveStatus,
  type QuestionRecord,
  toNumbers,
  toQuestionRecord,
  windowEnd,
} from "./records.js";
import { computeScores } from "./scoring.js";

const TOLERANCE = 1e-9;

export interface TournamentFinding {
  readonly slug: string;
  readonly check: "event_shape" | "live_resolution" | "scores" | "aggregate";
  readonly detail: string;
}

export interface TournamentVerification {
  readonly questionsChecked: number;
  readonly eventsChecked: number;
  readonly findings: TournamentFinding[];
  readonly passed: boolean;
}

type Fail = (check: TournamentFinding["check"], detail: string) => void;

async function checkEvents(
  db: Kysely<Database>,
  question: QuestionRecord,
  fail: Fail,
): Promise<number> {
  const events = await db
    .selectFrom("tournament_forecast_events")
    .select(["id", "probs"])
    .where("question_id", "=", question.id)
    .execute();
  for (const event of events) {
    const probs = toNumbers(event.probs);
    const sum = probs.reduce((total, probability) => total + probability, 0);
    if (probs.length !== question.bucketCount || Math.abs(sum - 1) > 1e-6) {
      fail("event_shape", `event ${event.id} has ${probs.length} entries summing to ${sum}`);
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
  const resolution = live[0];
  if (resolution === undefined || question.storedStatus !== "resolved") return;

  const expected = await computeScores(db, question, resolution.winning_bucket_index);
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

function sameVector(left: readonly number[] | null, right: readonly number[] | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.length === right.length &&
    left.every((probability, index) => Math.abs(probability - right[index]!) <= TOLERANCE)
  );
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
  const recomputed = computeAggregate(question, await latestVectors(db, question.id, cutoff));
  const stored = latest.probs === null ? null : toNumbers(latest.probs);
  if (recomputed.nForecasters !== latest.n_forecasters || !sameVector(stored, recomputed.probs)) {
    fail("aggregate", "the live aggregate does not match a recomputation");
  }
}

/**
 * Recomputes the tournament's derived state from its system of record
 * (forecast events and resolutions): stored scores must match the scorer,
 * and every open question's live aggregate must match the aggregator.
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

  return {
    questionsChecked: rows.length,
    eventsChecked,
    findings,
    passed: findings.length === 0,
  };
}
