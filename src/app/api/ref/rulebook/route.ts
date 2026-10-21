import { assertOnlyQueryParameters } from "../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import { getRulebook } from "../../../../lib/services/dealer/get-rulebook.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, (context) => {
    assertOnlyQueryParameters(new URL(request.url).searchParams, []);
    return jsonSuccess(getRulebook(new Date()), { requestId: context.requestId });
  });
}
