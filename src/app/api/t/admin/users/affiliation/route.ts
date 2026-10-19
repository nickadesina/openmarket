import { parseMutationBody, withMutationRoute } from "../../../../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../../../../lib/api/response.js";
import { adminAffiliationSchema } from "../../../../../../lib/api/tournament-schemas.js";
import { requireTournamentAdmin } from "../../../../../../lib/auth/tournament-session.js";
import { setAffiliationForHandle } from "../../../../../../lib/services/tournament/affiliation.js";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    await requireTournamentAdmin(context.db, request);
    const input = await parseMutationBody(request, adminAffiliationSchema, 1_024);
    const result = await setAffiliationForHandle(context.db, input.handle, input.affiliation);
    return jsonSuccess(result, { requestId: context.requestId });
  });
}
