import { assertOnlyQueryParameters } from "../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import { listQuestions } from "../../../../lib/services/tournament/get-question.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withReadRoute(
    request,
    async (context) => {
      assertOnlyQueryParameters(new URL(request.url).searchParams, []);
      const questions = await listQuestions(context.db);
      return jsonSuccess({ questions }, { requestId: context.requestId });
    },
    { cacheSeconds: 10 },
  );
}
