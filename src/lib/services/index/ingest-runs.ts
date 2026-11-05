/**
 * `ingest_runs`: one row per run of one source, `running` until it ends `ok`
 * or `failed` (with why). The cron job reads the last `ok` run of a source to
 * know where its next incremental run starts.
 */
import type { Kysely } from "kysely";

import type { Database, IndexSourceClass } from "../../db/schema.js";

/** A `running` row older than this belongs to a process that died (Vercel stops at 300 s). */
export const ABANDONED_RUN_MS = 15 * 60_000;

export interface RunCounts {
  readonly documentsSeen: number;
  readonly documentsNew: number;
  readonly marksNew: number;
}

export async function startIngestRun(
  db: Kysely<Database>,
  sourceClass: IndexSourceClass,
  now: Date,
): Promise<string> {
  await db
    .updateTable("ingest_runs")
    .set({ status: "failed", finished_at: now, error: "abandoned: the process ended mid-run" })
    .where("source_class", "=", sourceClass)
    .where("status", "=", "running")
    .where("started_at", "<", new Date(now.getTime() - ABANDONED_RUN_MS))
    .execute();
  const run = await db
    .insertInto("ingest_runs")
    .values({ source_class: sourceClass, status: "running", started_at: now })
    .returning("id")
    .executeTakeFirstOrThrow();
  return run.id;
}

export async function finishIngestRun(
  db: Kysely<Database>,
  runId: string,
  outcome: RunCounts & {
    readonly status: "ok" | "failed";
    /** Why it failed, or on an ok run what it could not read. */
    readonly error: string | null;
    readonly finishedAt: Date;
  },
): Promise<void> {
  await db
    .updateTable("ingest_runs")
    .set({
      status: outcome.status,
      finished_at: outcome.finishedAt,
      documents_seen: outcome.documentsSeen,
      documents_new: outcome.documentsNew,
      marks_new: outcome.marksNew,
      error: outcome.error,
    })
    .where("id", "=", runId)
    .execute();
}

/** When the last `ok` run of a source started, or null before the first. */
export async function lastOkRunStartedAt(
  db: Kysely<Database>,
  sourceClass: IndexSourceClass,
): Promise<Date | null> {
  const row = await db
    .selectFrom("ingest_runs")
    .select("started_at")
    .where("source_class", "=", sourceClass)
    .where("status", "=", "ok")
    .orderBy("started_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.started_at ?? null;
}
