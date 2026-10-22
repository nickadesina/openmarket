import {
  cookieHeader,
  createTournamentSession,
  readCookie,
  sessionCookie,
} from "../../../../../../lib/auth/tournament-session.js";
import {
  fetchXProfile,
  OAUTH_STATE_COOKIE,
  verifyAuthorizationState,
  xClientConfig,
} from "../../../../../../lib/auth/x-oauth.js";
import { getRuntimeDatabase } from "../../../../../../lib/db/runtime.js";
import { logUnexpectedError } from "../../../../../../lib/logging/server-log.js";
import { profileSlug } from "../../../../../../lib/services/tournament/identities.js";
import { upsertIdentity } from "../../../../../../lib/services/tournament/sign-in.js";

export const runtime = "nodejs";

function redirect(location: string, cookies: readonly string[]): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/**
 * X redirects here with a code; exchange it, upsert the identity, open a
 * session, and land on the forecaster's own page, where they set their
 * affiliation and restrictions.
 */
export async function GET(request: Request): Promise<Response> {
  const clearState = cookieHeader(OAUTH_STATE_COOKIE, "", 0);
  const params = new URL(request.url).searchParams;
  const config = xClientConfig();
  const state = verifyAuthorizationState(
    readCookie(request, OAUTH_STATE_COOKIE),
    params.get("state"),
  );
  const code = params.get("code");
  if (config === null || state === null || code === null || code.length > 2_048) {
    return redirect("/t?sign_in=failed", [clearState]);
  }

  try {
    const profile = await fetchXProfile(config, code, state.verifier);
    const db = getRuntimeDatabase();
    const userId = await upsertIdentity(db, {
      provider: "x",
      providerUserId: profile.id,
      handle: profile.username,
      displayName: profile.name,
      avatarUrl: profile.profileImageUrl,
      verified: profile.verified,
      providerCreatedAt: profile.createdAt,
    });
    const token = await createTournamentSession(db, userId);
    return redirect(`/t/u/${profileSlug("x", profile.username)}`, [
      clearState,
      sessionCookie(token),
    ]);
  } catch (error) {
    logUnexpectedError(crypto.randomUUID(), error);
    return redirect("/t?sign_in=failed", [clearState]);
  }
}
