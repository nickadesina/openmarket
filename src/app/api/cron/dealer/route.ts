import { withReadRoute } from "../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import { RUN_ID_HEADER, requireCronSecret } from "../../../../lib/auth/cron.js";
import { resolveRunId } from "../../../../lib/services/dealer/cron-run.js";
import { runDealerJob } from "../../../../lib/services/dealer/run-dealer-job.js";

export const runtime = "nodejs";

/**
 * The dealer job, every 15 minutes from `.github/workflows/dealer.yml`:
 * `Authorization: Bearer $CRON_SECRET`, and `X-Run-Id` naming the firing so
 * a rerun of it is reported, not repeated.
 */
export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    requireCronSecret(request, "dealer");
    const runId = resolveRunId(request.headers.get(RUN_ID_HEADER));
    const outcome = await runDealerJob(context.db, runId);
    const body =
      outcome.status === "already_ran"
        ? { run_id: outcome.runId, status: outcome.status, previous: outcome.previous }
        : { status: outcome.status, ...outcome.result };
    return jsonSuccess(body, { requestId: context.requestId });
  });
}
