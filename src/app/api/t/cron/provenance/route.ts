import { withReadRoute } from "../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { requireCronSecret } from "../../../../../lib/auth/cron.js";
import { runProvenance } from "../../../../../lib/services/tournament/provenance.js";
import { solanaConfig } from "../../../../../lib/solana/memo.js";

export const runtime = "nodejs";

/**
 * The hourly provenance job. The scheduled workflow calls it with
 * `Authorization: Bearer $CRON_SECRET`; without that secret configured the
 * route refuses every caller.
 */
export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    requireCronSecret(request, "provenance");
    const run = await runProvenance(context.db, solanaConfig());
    return jsonSuccess(run, { requestId: context.requestId });
  });
}
