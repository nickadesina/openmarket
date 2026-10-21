import type { Kysely, Transaction } from "kysely";

import type { Database } from "../../db/schema.js";
import { applyFlags } from "./apply-flags.js";
import { computeMids } from "./compute-mids.js";
import { type CronRunOutcome, runCronJob } from "./cron-run.js";
import { type DealerHealth, getDealerHealth } from "./get-dealer-health.js";
import { listInstruments } from "./list-instruments.js";
import { writeReferencePrices } from "./reference-prices.js";
import { requote } from "./requote.js";

export interface DealerStepContext {
  /** The run's transaction, under the dealer job's advisory lock. */
  readonly db: Transaction<Database>;
  readonly runId: string;
  readonly now: Date;
}

/**
 * The dealer job's steps, run in this order inside one transaction, each
 * result reported under its key: `state` widens and restores forwards on the
 * flags and mids seen since their last change; `list` gives every active
 * listing a live binary and forward; `mids` writes the model mid of every
 * live instrument (a just-listed one already has its first); `requote` posts
 * each quote that moved; `reference` publishes each blended reference price
 * that moved (README D14).
 */
export const DEALER_STEPS = {
  state: (context: DealerStepContext) => applyFlags(context.db, context.now),
  list: (context: DealerStepContext) => listInstruments(context.db, context.runId, context.now),
  mids: (context: DealerStepContext) => computeMids(context.db, context.runId, context.now),
  requote: (context: DealerStepContext) => requote(context.db, context.now),
  reference: (context: DealerStepContext) => writeReferencePrices(context.db, context.now),
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
