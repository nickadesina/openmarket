import { type Kysely, sql } from "kysely";

import type { Database } from "../../db/schema.js";
import { identitiesFor } from "./identities.js";
import type { PublicIdentity } from "./records.js";

/** Prize periods are calendar months in the tournament's home time zone. */
export const LEADERBOARD_TIME_ZONE = "America/Los_Angeles";
export const LEADERBOARD_PERIOD_PATTERN = /^(all|\d{4}-(0[1-9]|1[0-2]))$/;

export interface LeaderboardEntry extends PublicIdentity {
  readonly rank: number;
  readonly totalScore: number;
  readonly questionsResolved: number;
  readonly meanCoverage: number;
}

export interface Leaderboard {
  readonly period: string;
  readonly timeZone: string;
  readonly entries: LeaderboardEntry[];
}

/**
 * Sum of time-averaged scores over the period's live resolutions (sum, not
 * mean, so participation counts). Ties break on higher mean coverage;
 * entries tied on both share a rank.
 */
export async function getLeaderboard(db: Kysely<Database>, period: string): Promise<Leaderboard> {
  let query = db
    .selectFrom("tournament_scores as scores")
    .innerJoin("tournament_resolutions as resolutions", "resolutions.id", "scores.resolution_id")
    .innerJoin("tournament_questions as questions", "questions.id", "scores.question_id")
    .select([
      "scores.user_id",
      sql<number>`sum(scores.time_avg_log_score)`.as("total"),
      sql<string>`count(*)`.as("questions"),
      sql<number>`avg(scores.coverage)`.as("coverage"),
    ])
    .where("resolutions.superseded_by", "is", null)
    .where("questions.status", "=", "resolved");
  if (period !== "all") {
    query = query.where(
      sql<string>`to_char(resolutions.resolved_at at time zone ${LEADERBOARD_TIME_ZONE}, 'YYYY-MM')`,
      "=",
      period,
    );
  }
  const rows = await query
    .groupBy("scores.user_id")
    .orderBy("total", "desc")
    .orderBy("coverage", "desc")
    .orderBy("scores.user_id")
    .execute();

  const identities = await identitiesFor(
    db,
    rows.map((row) => row.user_id),
  );
  const entries: LeaderboardEntry[] = [];
  let rank = 0;
  rows.forEach((row, position) => {
    const previous = rows[position - 1];
    if (
      previous === undefined ||
      previous.total !== row.total ||
      previous.coverage !== row.coverage
    ) {
      rank = position + 1;
    }
    const identity = identities.get(row.user_id);
    if (identity === undefined) return;
    entries.push({
      ...identity,
      rank,
      totalScore: Number(row.total),
      questionsResolved: Number(row.questions),
      meanCoverage: Number(row.coverage),
    });
  });
  return { period, timeZone: LEADERBOARD_TIME_ZONE, entries };
}

/** "all" plus every month that holds a live resolution, newest first. */
export async function listLeaderboardPeriods(db: Kysely<Database>): Promise<string[]> {
  const rows = await db
    .selectFrom("tournament_resolutions")
    .select(
      sql<string>`to_char(resolved_at at time zone ${LEADERBOARD_TIME_ZONE}, 'YYYY-MM')`.as(
        "period",
      ),
    )
    .where("superseded_by", "is", null)
    .distinct()
    .orderBy("period", "desc")
    .execute();
  return ["all", ...rows.map((row) => row.period)];
}
