import { consumeProfileRateLimit } from "../../../../../lib/services/tournament/profile-rate-limit.js";
import { parseMutationBody, withMutationRoute } from "../../../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { affiliationInputSchema } from "../../../../../lib/api/tournament-schemas.js";
import { requireTournamentUserId } from "../../../../../lib/auth/tournament-session.js";
import { setAffiliation } from "../../../../../lib/services/tournament/affiliation.js";

export const runtime = "nodejs";

/** Sets or clears the signed-in forecaster's self-reported affiliation. */
export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    const userId = await requireTournamentUserId(context.db, request);
    const input = await parseMutationBody(request, affiliationInputSchema, 512);
    await consumeProfileRateLimit(context.db, userId, request);
    const result = await setAffiliation(context.db, userId, input.affiliation);
    return jsonSuccess(result, { requestId: context.requestId });
  });
}
