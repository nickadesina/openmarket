import { consumeProfileRateLimit } from "../../../../../lib/services/tournament/profile-rate-limit.js";
import { parseMutationBody, withMutationRoute } from "../../../../../lib/api/mutation-route.js";
import { assertOnlyQueryParameters } from "../../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { restrictionsInputSchema } from "../../../../../lib/api/tournament-schemas.js";
import { requireTournamentUserId } from "../../../../../lib/auth/tournament-session.js";
import {
  attestRestrictions,
  getRestrictions,
} from "../../../../../lib/services/tournament/restrictions.js";

export const runtime = "nodejs";

/** The signed-in forecaster's restricted-person attestation and the names they can attest to. */
export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    assertOnlyQueryParameters(new URL(request.url).searchParams, []);
    const userId = await requireTournamentUserId(context.db, request);
    return jsonSuccess(await getRestrictions(context.db, userId), {
      requestId: context.requestId,
    });
  });
}

/** Attests the listed names the forecaster is employed by, a director of, or invested in. */
export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    assertOnlyQueryParameters(new URL(request.url).searchParams, []);
    const userId = await requireTournamentUserId(context.db, request);
    const input = await parseMutationBody(request, restrictionsInputSchema, 2_048);
    await consumeProfileRateLimit(context.db, userId, request);
    const result = await attestRestrictions(context.db, userId, input.companies);
    return jsonSuccess(result, { requestId: context.requestId });
  });
}
