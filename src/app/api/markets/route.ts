import { assertOnlyQueryParameters } from "../../../lib/api/pagination.js";
import { withReadRoute } from "../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../lib/api/response.js";
import { listMarkets } from "../../../lib/services/list-markets.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    assertOnlyQueryParameters(new URL(request.url).searchParams, []);
    const markets = await listMarkets(context.db);
    return jsonSuccess(markets, { requestId: context.requestId });
  });
}
