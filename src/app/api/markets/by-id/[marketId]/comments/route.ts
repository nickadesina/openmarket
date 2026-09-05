import { parseMutationBody, withMutationRoute } from "../../../../../../lib/api/mutation-route.js";
import {
  assertOnlyQueryParameters,
  parseOptionalString,
} from "../../../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../../lib/api/response.js";
import { commentInputSchema } from "../../../../../../lib/api/schemas.js";
import { requireCurrentUserId } from "../../../../../../lib/auth/current-user.js";
import { commentNetworkKey } from "../../../../../../lib/security/comment-address.js";
import { createComment } from "../../../../../../lib/services/create-comment.js";
import { listComments } from "../../../../../../lib/services/list-comments.js";

export const runtime = "nodejs";

interface CommentsRouteContext {
  readonly params: Promise<{ readonly marketId: string }>;
}

export function GET(request: Request, routeContext: CommentsRouteContext): Promise<Response> {
  return withReadRoute(request, async (context) => {
    const { marketId } = await routeContext.params;
    const searchParams = new URL(request.url).searchParams;
    assertOnlyQueryParameters(searchParams, ["parentId", "cursor"]);
    const parentId = parseOptionalString(searchParams, "parentId", { maximumLength: 36 });
    const cursor = parseOptionalString(searchParams, "cursor", { maximumLength: 512 });
    const page = await listComments(context.db, marketId, {
      ...(parentId === undefined ? {} : { parentId }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    return jsonSuccess(page, { requestId: context.requestId });
  });
}

export function POST(request: Request, routeContext: CommentsRouteContext): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    assertOnlyQueryParameters(new URL(request.url).searchParams, []);
    const { marketId } = await routeContext.params;
    const input = await parseMutationBody(request, commentInputSchema, 16_384);
    const userId = await requireCurrentUserId(request, () => context.db);
    const result = await createComment(
      context.db,
      userId,
      marketId,
      input,
      commentNetworkKey(request),
    );
    return jsonSuccess(result, { requestId: context.requestId });
  });
}
