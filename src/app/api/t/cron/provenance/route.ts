import { withReadRoute } from "../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { RUN_ID_HEADER, requireCronSecret } from "../../../../../lib/auth/cron.js";
import { resolveRunId } from "../../../../../lib/services/dealer/cron-run.js";
import { runProvenanceJob } from "../../../../../lib/services/tournament/run-provenance-job.js";
import { solanaConfig } from "../../../../../lib/solana/memo.js";

export const runtime = "nodejs";
// Next statically extracts this literal; tests tie it to CRON_EXECUTION_SECONDS.
export const maxDuration = 300;

/**
 * The hourly provenance job. Vercel Cron calls it with
 * `Authorization: Bearer $CRON_SECRET`; without that secret configured the
 * route refuses every caller.
 */
export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    requireCronSecret(request, "provenance");
    const runId = resolveRunId(
      request.headers.get(RUN_ID_HEADER),
      "provenance",
      request.headers.get("user-agent"),
    );
    const run = await runProvenanceJob(context.db, runId, solanaConfig());
    return jsonSuccess(run, { requestId: context.requestId });
  });
}
