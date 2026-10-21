import type { Kysely, Transaction } from "kysely";

import type { Database } from "../../db/schema.js";
import { computeMids } from "./compute-mids.js";
import { type CronRunOutcome, runCronJob } from "./cron-run.js";
import { type DealerHealth, getDealerHealth } from "./get-dealer-health.js";
import { listInstruments } from "./list-instruments.js";

export interface DealerStepContext {
  /** The run's transaction, under the dealer job's advisory lock. */
  readonly db: Transaction<Database>;
  readonly runId: string;
  readonly now: Date;
}

/**
 * The dealer job's steps, run in this order inside one transaction, each
 * result reported under its key: `list` gives every active listing a live
 * binary and forward, and `mids` then writes the model mid of every live
 * instrument (a just-listed one already has its first).
 */
export const DEALER_STEPS = {
  list: (context: DealerStepContext) => listInstruments(context.db, context.runId, context.now),
  mids: (context: DealerStepContext) => computeMids(context.db, context.runId, context.now),
} as const;

type DealerSteps = typeof DEALER_STEPS;
export type DealerStepResults = {
  readonly [K in keyof DealerSteps]: Awaited<ReturnType<DealerSteps[K]>>;
};

export interface DealerRunSummary {
  readonly run_id: string;
  readonly instruments: number;
  readonly mids_written: number;
  readonly steps: DealerStepResults;
  readonly health: DealerHealth;
}

export type DealerJobOutcome = CronRunOutcome<DealerRunSummary>;

/** One firing of /api/cron/dealer: every step, once per run id. */
export async function runDealerJob(
  db: Kysely<Database>,
  runId: string,
  now: Date = new Date(),
): Promise<DealerJobOutcome> {
  return runCronJob(db, "dealer", runId, async (transaction, id) => {
    const context: DealerStepContext = { db: transaction, runId: id, now };
    const results: Record<string, unknown> = {};
    for (const [name, step] of Object.entries(DEALER_STEPS)) results[name] = await step(context);
    const steps = results as DealerStepResults;
    return {
      run_id: id,
      instruments: steps.mids.instruments,
      mids_written: steps.mids.mids_written,
      steps,
      health: await getDealerHealth(transaction),
    };
  });
}
