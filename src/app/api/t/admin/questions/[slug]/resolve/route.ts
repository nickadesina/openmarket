import {
  parseMutationBody,
  withMutationRoute,
} from "../../../../../../../lib/api/mutation-route.js";
import { parseSlug } from "../../../../../../../lib/api/pagination.js";
import { jsonSuccess } from "../../../../../../../lib/api/response.js";
import { resolveQuestionSchema } from "../../../../../../../lib/api/tournament-schemas.js";
import { requireTournamentAdmin } from "../../../../../../../lib/auth/tournament-session.js";
import { resolveQuestion } from "../../../../../../../lib/services/tournament/admin.js";

export const runtime = "nodejs";

interface AdminQuestionRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

export function POST(request: Request, routeContext: AdminQuestionRouteContext): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    const adminUserId = await requireTournamentAdmin(context.db, request);
    const slug = parseSlug((await routeContext.params).slug);
    const input = await parseMutationBody(request, resolveQuestionSchema, 32_768);
    const result = await resolveQuestion(context.db, slug, input, adminUserId);
    return jsonSuccess(result, { requestId: context.requestId });
  });
}
