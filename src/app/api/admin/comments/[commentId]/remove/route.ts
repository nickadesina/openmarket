import { parseMutationBody, withMutationRoute } from "../../../../../../lib/api/mutation-route.js";
import { assertOnlyQueryParameters } from "../../../../../../lib/api/pagination.js";
import { jsonSuccess } from "../../../../../../lib/api/response.js";
import { removeCommentInputSchema } from "../../../../../../lib/api/schemas.js";
import { requireCurrentAdmin } from "../../../../../../lib/auth/current-admin.js";
import { removeComment } from "../../../../../../lib/services/remove-comment.js";

export const runtime = "nodejs";

interface RemoveCommentRouteContext {
  readonly params: Promise<{ readonly commentId: string }>;
}

export function POST(request: Request, routeContext: RemoveCommentRouteContext): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    requireCurrentAdmin(request);
    assertOnlyQueryParameters(new URL(request.url).searchParams, []);
    await parseMutationBody(request, removeCommentInputSchema, 1_024);
    const { commentId } = await routeContext.params;
    const result = await removeComment(context.db, commentId);
    return jsonSuccess(result, { requestId: context.requestId });
  });
}
