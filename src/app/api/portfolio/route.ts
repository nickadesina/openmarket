import { requireCurrentUserId } from "../../../lib/auth/current-user.js";
import {
  assertOnlyQueryParameters,
  parseBoundedInteger,
} from "../../../lib/api/pagination.js";
import { withReadRoute } from "../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../lib/api/response.js";
import {
  getPortfolio,
  PORTFOLIO_DEFAULT_TRADE_LIMIT,
  PORTFOLIO_MAX_TRADE_LIMIT,
} from "../../../lib/services/portfolio.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    const searchParams = new URL(request.url).searchParams;
    assertOnlyQueryParameters(searchParams, ["offset", "limit"]);
    const offset = parseBoundedInteger(searchParams, "offset", {
      defaultValue: 0,
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    const limit = parseBoundedInteger(searchParams, "limit", {
      defaultValue: PORTFOLIO_DEFAULT_TRADE_LIMIT,
      minimum: 1,
      maximum: PORTFOLIO_MAX_TRADE_LIMIT,
    });

    const userId = await requireCurrentUserId(request, () => context.db);
    const portfolio = await getPortfolio(context.db, userId, { offset, limit });
    return jsonSuccess(portfolio, { requestId: context.requestId });
  });
}
