import { assertOnlyQueryParameters } from "../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import { getDerivedNumbers } from "../../../../lib/services/tournament/derived.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withReadRoute(
    request,
    async (context) => {
      assertOnlyQueryParameters(new URL(request.url).searchParams, []);
      const derived = await getDerivedNumbers(context.db);
      return jsonSuccess(derived, { requestId: context.requestId });
    },
    { cacheSeconds: 10 },
  );
}
