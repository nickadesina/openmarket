import {
  parseMutationBody,
  withMutationRoute,
} from "../../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import { seedInputSchema } from "../../../../lib/api/schemas.js";
import { requireCurrentAdmin } from "../../../../lib/auth/current-admin.js";
import { seedMarket } from "../../../../lib/services/seed-market.js";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    requireCurrentAdmin(request);
    const input = await parseMutationBody(request, seedInputSchema);
    const result = await seedMarket(context.db, input);

    return jsonSuccess(
      {
        outcome: result.outcome,
        market_id: result.market.id,
        slug: result.company.slug,
        status: result.market.status,
        metric_kind: result.market.metric_kind,
        current_metric: result.market.current_metric,
        created_at: result.market.created_at,
      },
      { requestId: context.requestId },
    );
  });
}
