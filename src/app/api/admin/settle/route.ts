import { parseMutationBody, withMutationRoute } from "../../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import { settlementInputSchema } from "../../../../lib/api/schemas.js";
import { requireCurrentAdmin } from "../../../../lib/auth/current-admin.js";
import { settleMarket } from "../../../../lib/services/settle-market.js";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    requireCurrentAdmin(request);
    const input = await parseMutationBody(request, settlementInputSchema, 16_384);
    const result = await settleMarket(context.db, input);
    return jsonSuccess(result, { requestId: context.requestId });
  });
}
