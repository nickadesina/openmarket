import { withReadRoute } from "../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import { RUN_ID_HEADER, requireCronSecret } from "../../../../lib/auth/cron.js";
import { resolveRunId } from "../../../../lib/services/dealer/cron-run.js";
import { runSettleJob } from "../../../../lib/services/dealer/settle-instruments.js";

export const runtime = "nodejs";

/**
 * The settle job, hourly from `.github/workflows/settle.yml`:
 * `Authorization: Bearer $CRON_SECRET`, and `X-Run-Id` naming the firing so
 * a rerun of it is reported, not repeated. Each instrument settles in its own
 * transaction.
 */
export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    requireCronSecret(request, "settle");
    const runId = resolveRunId(request.headers.get(RUN_ID_HEADER));
    const outcome = await runSettleJob(context.db, runId);
    const body =
      outcome.status === "already_ran"
        ? { run_id: outcome.runId, status: outcome.status, previous: outcome.previous }
        : { status: outcome.status, ...outcome.result };
    return jsonSuccess(body, { requestId: context.requestId });
  });
}
