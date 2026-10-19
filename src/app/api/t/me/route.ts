import { assertOnlyQueryParameters } from "../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import {
  isTournamentAdmin,
  resolveTournamentSession,
  sessionCookie,
} from "../../../../lib/auth/tournament-session.js";
import { xClientConfig } from "../../../../lib/auth/x-oauth.js";
import { devSignInEnabled } from "../../../../lib/config/tournament.js";
import { getViewer } from "../../../../lib/services/tournament/forecaster.js";

export const runtime = "nodejs";

/** The signed-in viewer, or null; never cached. Also slides the session cookie. */
export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    assertOnlyQueryParameters(new URL(request.url).searchParams, []);
    const signIn = { x: xClientConfig() !== null, dev: devSignInEnabled() };
    const session = await resolveTournamentSession(context.db, request);
    const viewer = session === null ? null : await getViewer(context.db, session.userId);
    const isAdmin = session === null ? false : await isTournamentAdmin(context.db, session.userId);
    return jsonSuccess(
      { viewer, isAdmin, signIn },
      {
        requestId: context.requestId,
        ...(session?.refreshedToken == null
          ? {}
          : { headers: { "Set-Cookie": sessionCookie(session.refreshedToken) } }),
      },
    );
  });
}
