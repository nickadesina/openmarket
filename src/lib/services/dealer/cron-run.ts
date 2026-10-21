import { randomUUID } from "node:crypto";

import { type Kysely, sql, type Transaction } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type { CronRunRow, CronRunStatus, Database } from "../../db/schema.js";

/** The three scheduled jobs (TECHNICAL_DESIGN.md §11); there are no others. */
export type CronJob = "ingest" | "dealer" | "settle";

/** Letters, digits and `._:-`; GitHub's `${run_id}-${run_attempt}` fits. */
const RUN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** The caller's run id, trimmed, or a fresh UUID when it sent none. */
export function resolveRunId(supplied: string | null | undefined): string {
  const runId = supplied?.trim() ?? "";
  if (runId === "") return randomUUID();
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new ServiceError("INVALID_INPUT", "X-Run-Id must be 1–128 of A–Z a–z 0–9 . _ : -");
  }
  return runId;
}

export interface PreviousRun {
  readonly job: string;
  readonly status: CronRunStatus;
  readonly started_at: Date;
  readonly finished_at: Date | null;
}

export type BeginCronRunResult =
  | { readonly status: "started"; readonly runId: string }
  | { readonly status: "already_ran"; readonly runId: string; readonly previous: PreviousRun };

/**
 * Claims `runId` for `job` with a `running` row. A run id is used once:
 * a second call with it, whatever its job, reports the first run instead.
 */
export async function beginCronRun(
  db: Kysely<Database>,
  job: CronJob,
  runId: string,
): Promise<BeginCronRunResult> {
  const inserted = await db
    .insertInto("cron_runs")
    .values({ job, run_id: runId, status: "running" })
    .onConflict((conflict) => conflict.column("run_id").doNothing())
    .returning("run_id")
    .executeTakeFirst();
  if (inserted !== undefined) return { status: "started", runId };
  const previous: Pick<CronRunRow, keyof PreviousRun> = await db
    .selectFrom("cron_runs")
    .select(["job", "status", "started_at", "finished_at"])
    .where("run_id", "=", runId)
    .executeTakeFirstOrThrow();
  return { status: "already_ran", runId, previous };
}

/**
 * Closes a `running` row with `detail` (stored as its JSON) in detail_json;
 * a row already closed is left as it is.
 */
export async function finishCronRun(
  db: Kysely<Database>,
  runId: string,
  status: Exclude<CronRunStatus, "running">,
  detail: unknown,
): Promise<void> {
  await db
    .updateTable("cron_runs")
    .set({ status, detail_json: JSON.stringify(detail), finished_at: sql<Date>`clock_timestamp()` })
    .where("run_id", "=", runId)
    .where("status", "=", "running")
    .execute();
}

export type CronRunOutcome<T> =
  | { readonly status: "succeeded"; readonly runId: string; readonly result: T }
  | { readonly status: "already_ran"; readonly runId: string; readonly previous: PreviousRun };

/**
 * One firing of a scheduled job: claim the run id, then do `work` in one
 * transaction under the job's advisory lock (so overlapping firings run one
 * after the other) and mark the run succeeded with the result as its detail
 * in that same transaction. On an error the work rolls back, the run is
 * marked failed with the message, and the error is rethrown.
 */
export async function runCronJob<T>(
  db: Kysely<Database>,
  job: CronJob,
  runId: string,
  work: (transaction: Transaction<Database>, runId: string) => Promise<T>,
): Promise<CronRunOutcome<T>> {
  const begun = await beginCronRun(db, job, runId);
  if (begun.status === "already_ran") return begun;
  try {
    const result = await db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext('openmarket_cron'), hashtext(${job}))`.execute(
        transaction,
      );
      const value = await work(transaction, runId);
      await finishCronRun(transaction, runId, "succeeded", value);
      return value;
    });
    return { status: "succeeded", runId, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "the job failed";
    await finishCronRun(db, runId, "failed", { error: message });
    throw error;
  }
}
