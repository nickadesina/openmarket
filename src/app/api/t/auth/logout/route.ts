import { parseMutationBody, withMutationRoute } from "../../../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { emptyBodySchema } from "../../../../../lib/api/tournament-schemas.js";
import {
  clearedSessionCookie,
  destroyTournamentSession,
} from "../../../../../lib/auth/tournament-session.js";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    await parseMutationBody(request, emptyBodySchema, 256);
    await destroyTournamentSession(context.db, request);
    return jsonSuccess(
      { signedOut: true },
      { requestId: context.requestId, headers: { "Set-Cookie": clearedSessionCookie() } },
    );
  });
}
