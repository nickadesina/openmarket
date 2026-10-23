import { withReadRoute } from "../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import { RUN_ID_HEADER, requireCronSecret } from "../../../../lib/auth/cron.js";
import { resolveRunId } from "../../../../lib/services/dealer/cron-run.js";
import { runSettleJob } from "../../../../lib/services/dealer/settle-instruments.js";

export const runtime = "nodejs";
// Next statically extracts this literal; tests tie it to CRON_EXECUTION_SECONDS.
export const maxDuration = 300;

/** Vercel Cron calls this with the bearer secret; manual callers may supply X-Run-Id. */
export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    requireCronSecret(request, "settle");
    const runId = resolveRunId(
      request.headers.get(RUN_ID_HEADER),
      "settle",
      request.headers.get("user-agent"),
    );
    const outcome = await runSettleJob(context.db, runId);
    const body =
      outcome.status === "already_ran"
        ? { run_id: outcome.runId, status: outcome.status, previous: outcome.previous }
        : { status: outcome.status, ...outcome.result };
    return jsonSuccess(body, { requestId: context.requestId });
  });
}
