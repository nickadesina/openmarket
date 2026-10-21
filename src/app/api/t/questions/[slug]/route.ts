import { assertOnlyQueryParameters, parseSlug } from "../../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { getQuestion } from "../../../../../lib/services/tournament/get-question.js";

export const runtime = "nodejs";

interface QuestionRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

export function GET(request: Request, routeContext: QuestionRouteContext): Promise<Response> {
  return withReadRoute(
    request,
    async (context) => {
      assertOnlyQueryParameters(new URL(request.url).searchParams, []);
      const { slug } = await routeContext.params;
      const question = await getQuestion(context.db, parseSlug(slug));
      return jsonSuccess(question, { requestId: context.requestId });
    },
    { cacheSeconds: 10 },
  );
}
