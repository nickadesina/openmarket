import { ServiceError } from "../../../../../lib/api/errors.js";
import { parseMutationBody, withMutationRoute } from "../../../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { devSignInSchema } from "../../../../../lib/api/tournament-schemas.js";
import {
  createTournamentSession,
  sessionCookie,
} from "../../../../../lib/auth/tournament-session.js";
import { devSignInEnabled } from "../../../../../lib/config/tournament.js";
import { upsertIdentity } from "../../../../../lib/services/tournament/sign-in.js";

export const runtime = "nodejs";

/**
 * Development-only sign-in as a `dev` identity, for local work and browser
 * tests without X credentials. Disabled outside `next dev`.
 */
export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    if (!devSignInEnabled()) {
      throw new ServiceError("SIGN_IN_UNAVAILABLE", "Development sign-in is disabled.");
    }
    const input = await parseMutationBody(request, devSignInSchema, 256);
    const { userId } = await upsertIdentity(context.db, {
      provider: "dev",
      providerUserId: input.handle.toLowerCase(),
      handle: input.handle,
      displayName: input.handle,
      avatarUrl: null,
      verified: false,
      providerCreatedAt: null,
    });
    const token = await createTournamentSession(context.db, userId);
    return jsonSuccess(
      { handle: input.handle },
      { requestId: context.requestId, headers: { "Set-Cookie": sessionCookie(token) } },
    );
  });
}
