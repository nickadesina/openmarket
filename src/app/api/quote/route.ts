import { isServiceError } from "../../../lib/api/errors.js";
import { parseMutationBody, withMutationRoute } from "../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../lib/api/response.js";
import { quoteInputSchema } from "../../../lib/api/schemas.js";
import { requireCurrentUserId } from "../../../lib/auth/current-user.js";
import { quoteMarket } from "../../../lib/services/quote.js";
import { consumeRateLimit, rateLimitNetworkKey } from "../../../lib/services/rate-limit.js";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    const input = await parseMutationBody(request, quoteInputSchema, 4_096);
    let userId: string | undefined;

    try {
      userId = await requireCurrentUserId(request, () => context.db);
    } catch (error: unknown) {
      const anonymousBuy =
        input.action === "buy" && isServiceError(error) && error.code === "USER_REQUIRED";
      if (!anonymousBuy) {
        throw error;
      }
    }

    await consumeRateLimit(context.db, "quote", userId ?? rateLimitNetworkKey(request));
    const quote = await quoteMarket(context.db, input, userId);
    return jsonSuccess(quote, { requestId: context.requestId });
  });
}
