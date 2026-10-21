import { parseMutationBody, withMutationRoute } from "../../../../../lib/api/mutation-route.js";
import { assertOnlyQueryParameters } from "../../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { questionInputSchema } from "../../../../../lib/api/tournament-schemas.js";
import { requireTournamentAdmin } from "../../../../../lib/auth/tournament-session.js";
import {
  listAdminQuestions,
  saveDraftQuestion,
} from "../../../../../lib/services/tournament/admin.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    assertOnlyQueryParameters(new URL(request.url).searchParams, []);
    await requireTournamentAdmin(context.db, request);
    const questions = await listAdminQuestions(context.db);
    return jsonSuccess({ questions }, { requestId: context.requestId });
  });
}

/** Creates a draft question, or replaces a draft with the same slug. */
export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    await requireTournamentAdmin(context.db, request);
    const input = await parseMutationBody(request, questionInputSchema, 65_536);
    const saved = await saveDraftQuestion(context.db, input);
    return jsonSuccess(saved, { requestId: context.requestId });
  });
}
