import { withReadRoute } from "../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import { requireCronSecret } from "../../../../lib/auth/cron.js";
import {
  runScheduledIngest,
  scheduledIngestSummary,
  scheduledSecClient,
} from "../../../../lib/services/index/run-scheduled-ingest.js";

export const runtime = "nodejs";
// Next statically extracts this literal; the route test ties it to CRON_EXECUTION_SECONDS.
export const maxDuration = 300;

/**
 * Vercel Cron, daily: each EDGAR source incrementally since its last ok run,
 * stopping before the 300 s limit (src/lib/services/index/run-scheduled-ingest.ts).
 */
export function GET(request: Request): Promise<Response> {
  const startedAt = new Date();
  return withReadRoute(request, async (context) => {
    requireCronSecret(request, "ingest");
    const client = scheduledSecClient();
    const report = await runScheduledIngest(context.db, { startedAt, client });
    return jsonSuccess(scheduledIngestSummary(report), { requestId: context.requestId });
  });
}
