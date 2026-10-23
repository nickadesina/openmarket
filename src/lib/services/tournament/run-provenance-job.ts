import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import type { SolanaConfig } from "../../solana/memo.js";
import { beginCronRun, finishCronRun } from "../dealer/cron-run.js";
import { runProvenance } from "./provenance.js";

/**
 * Hour batches already deduplicate roots under an advisory lock. Track route
 * invocations too: idle hours have no batch, and duplicate deliveries must not
 * race to post the same pending memo. Keep the existing posting report response.
 */
export async function runProvenanceJob(
  db: Kysely<Database>,
  runId: string,
  config: SolanaConfig | null,
  fetchImpl: typeof fetch = fetch,
) {
  const begun = await beginCronRun(db, "provenance", runId);
  if (begun.status === "already_ran") {
    return { status: begun.status, run_id: runId, previous: begun.previous };
  }
  try {
    const report = await runProvenance(db, config, fetchImpl);
    const status = report.posting?.errors.length ? "failed" : "succeeded";
    await finishCronRun(db, runId, status, report);
    return report;
  } catch (error) {
    try {
      await finishCronRun(db, runId, "failed", { error: "Provenance invocation failed." });
    } catch {
      // Preserve the original failure if bookkeeping is unavailable.
    }
    throw error;
  }
}
