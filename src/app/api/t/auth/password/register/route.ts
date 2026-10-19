import { parseMutationBody, withMutationRoute } from "../../../../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../../../../lib/api/response.js";
import { passwordAccountSchema } from "../../../../../../lib/api/tournament-schemas.js";
import {
  createTournamentSession,
  sessionCookie,
} from "../../../../../../lib/auth/tournament-session.js";
import { consumeNetworkRateLimit } from "../../../../../../lib/services/rate-limit.js";
import { registerPasswordAccount } from "../../../../../../lib/services/tournament/password-account.js";

export const runtime = "nodejs";

/** Creates a username/password account and signs it in. */
export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    const input = await parseMutationBody(request, passwordAccountSchema, 1_024);
    await consumeNetworkRateLimit(context.db, "tournament_register", request);
    const userId = await registerPasswordAccount(context.db, input);
    const token = await createTournamentSession(context.db, userId);
    return jsonSuccess(
      { username: input.username },
      { requestId: context.requestId, headers: { "Set-Cookie": sessionCookie(token) } },
    );
  });
}
