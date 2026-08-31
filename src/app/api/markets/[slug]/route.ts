import {
  assertOnlyQueryParameters,
  parseSlug,
} from "../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import { getMarket } from "../../../../lib/services/get-market.js";

export const runtime = "nodejs";

interface MarketRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

export function GET(
  request: Request,
  routeContext: MarketRouteContext,
): Promise<Response> {
  return withReadRoute(request, async (context) => {
    assertOnlyQueryParameters(new URL(request.url).searchParams, []);
    const { slug: rawSlug } = await routeContext.params;
    const market = await getMarket(context.db, parseSlug(rawSlug));
    return jsonSuccess(market, { requestId: context.requestId });
  });
}
