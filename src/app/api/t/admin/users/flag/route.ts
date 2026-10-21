import { parseMutationBody, withMutationRoute } from "../../../../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../../../../lib/api/response.js";
import { flagUserSchema } from "../../../../../../lib/api/tournament-schemas.js";
import { requireTournamentAdmin } from "../../../../../../lib/auth/tournament-session.js";
import { setUserFlag } from "../../../../../../lib/services/tournament/admin.js";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    await requireTournamentAdmin(context.db, request);
    const input = await parseMutationBody(request, flagUserSchema, 2_048);
    const result = await setUserFlag(context.db, input);
    return jsonSuccess(result, { requestId: context.requestId });
  });
}
