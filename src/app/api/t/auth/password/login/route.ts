import { ServiceError } from "../../../../../../lib/api/errors.js";
import { parseMutationBody, withMutationRoute } from "../../../../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../../../../lib/api/response.js";
import { passwordSignInSchema } from "../../../../../../lib/api/tournament-schemas.js";
import {
  createTournamentSession,
  sessionCookie,
} from "../../../../../../lib/auth/tournament-session.js";
import {
  assertNetworkRateLimitAvailable,
  assertRateLimitAvailable,
  consumeNetworkRateLimit,
  consumeRateLimit,
} from "../../../../../../lib/services/rate-limit.js";
import { verifyPasswordAccount } from "../../../../../../lib/services/tournament/password-account.js";

export const runtime = "nodejs";

/**
 * Signs in a username/password account. Only failures consume quota, per
 * network and per username, so guessing one account is throttled even from
 * many networks; a correct password is never slowed by its own successes.
 */
export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    const input = await parseMutationBody(request, passwordSignInSchema, 1_024);
    const accountKey = `username:${input.username.toLowerCase()}`;
    await assertNetworkRateLimitAvailable(context.db, "tournament_login", request);
    await assertRateLimitAvailable(context.db, "tournament_login", accountKey);
    const userId = await verifyPasswordAccount(context.db, input);
    if (userId === null) {
      await consumeNetworkRateLimit(context.db, "tournament_login", request);
      await consumeRateLimit(context.db, "tournament_login", accountKey);
      throw new ServiceError("SIGN_IN_FAILED", "That username and password do not match.");
    }
    const token = await createTournamentSession(context.db, userId);
    return jsonSuccess(
      { signedIn: true },
      { requestId: context.requestId, headers: { "Set-Cookie": sessionCookie(token) } },
    );
  });
}
