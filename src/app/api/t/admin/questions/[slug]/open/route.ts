import {
  parseMutationBody,
  withMutationRoute,
} from "../../../../../../../lib/api/mutation-route.js";
import { parseSlug } from "../../../../../../../lib/api/pagination.js";
import { jsonSuccess } from "../../../../../../../lib/api/response.js";
import { emptyBodySchema } from "../../../../../../../lib/api/tournament-schemas.js";
import { requireTournamentAdmin } from "../../../../../../../lib/auth/tournament-session.js";
import { openQuestion } from "../../../../../../../lib/services/tournament/admin.js";

export const runtime = "nodejs";

interface AdminQuestionRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

export function POST(request: Request, routeContext: AdminQuestionRouteContext): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    await requireTournamentAdmin(context.db, request);
    const slug = parseSlug((await routeContext.params).slug);
    await parseMutationBody(request, emptyBodySchema, 256);
    const result = await openQuestion(context.db, slug);
    return jsonSuccess(result, { requestId: context.requestId });
  });
}
