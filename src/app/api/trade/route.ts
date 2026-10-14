import { parseMutationBody, withMutationRoute } from "../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../lib/api/response.js";
import { tradeInputSchema } from "../../../lib/api/schemas.js";
import { requireCurrentUserId } from "../../../lib/auth/current-user.js";
import { executeTrade } from "../../../lib/services/execute-trade.js";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    const input = await parseMutationBody(request, tradeInputSchema, 4_096);
    const userId = await requireCurrentUserId(request, () => context.db);
    const execution = await executeTrade(context.db, userId, input);

    return jsonSuccess(execution.result, {
      requestId: context.requestId,
      ...(execution.replayed ? { headers: { "Idempotent-Replayed": "true" } } : {}),
    });
  });
}
