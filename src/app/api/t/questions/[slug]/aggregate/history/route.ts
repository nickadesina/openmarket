import { assertOnlyQueryParameters, parseSlug } from "../../../../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../../../lib/api/response.js";
import { aggregateHistory } from "../../../../../../../lib/services/tournament/get-question.js";

export const runtime = "nodejs";

interface HistoryRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

export function GET(request: Request, routeContext: HistoryRouteContext): Promise<Response> {
  return withReadRoute(
    request,
    async (context) => {
      assertOnlyQueryParameters(new URL(request.url).searchParams, []);
      const { slug } = await routeContext.params;
      const history = await aggregateHistory(context.db, parseSlug(slug));
      return jsonSuccess(history, { requestId: context.requestId });
    },
    { cacheSeconds: 10 },
  );
}
