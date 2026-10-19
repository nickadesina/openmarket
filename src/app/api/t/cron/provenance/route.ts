import { createHash, timingSafeEqual } from "node:crypto";

import { ServiceError } from "../../../../../lib/api/errors.js";
import { withReadRoute } from "../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { runProvenance } from "../../../../../lib/services/tournament/provenance.js";
import { solanaConfig } from "../../../../../lib/solana/memo.js";

export const runtime = "nodejs";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * The hourly provenance job. The scheduled workflow calls it with
 * `Authorization: Bearer $CRON_SECRET`; without that secret configured the
 * route refuses every caller.
 */
export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    const secret = process.env.CRON_SECRET?.trim();
    const supplied = request.headers.get("authorization") ?? "";
    if (
      secret === undefined ||
      secret.length < 16 ||
      !timingSafeEqual(digest(supplied), digest(`Bearer ${secret}`))
    ) {
      throw new ServiceError("ADMIN_REQUIRED", "The provenance job needs the cron secret.");
    }
    const run = await runProvenance(context.db, solanaConfig());
    return jsonSuccess(run, { requestId: context.requestId });
  });
}
