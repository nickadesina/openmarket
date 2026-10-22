import { cookieHeader } from "../../../../../../lib/auth/tournament-session.js";
import {
  beginAuthorization,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_MS,
  safeReturnPath,
  xClientConfig,
} from "../../../../../../lib/auth/x-oauth.js";
import { logUnexpectedError } from "../../../../../../lib/logging/server-log.js";

export const runtime = "nodejs";

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (cookie !== undefined) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/** Starts X sign-in: a PKCE state cookie, then the X consent screen. */
export function GET(request: Request): Response {
  const returnTo = safeReturnPath(new URL(request.url).searchParams.get("return"));
  const config = xClientConfig();
  if (config === null) return redirect(`/t?sign_in=unavailable`);
  try {
    const authorization = beginAuthorization(config, returnTo);
    return redirect(
      authorization.url,
      cookieHeader(OAUTH_STATE_COOKIE, authorization.stateCookie, OAUTH_STATE_MAX_AGE_MS),
    );
  } catch (error) {
    logUnexpectedError(crypto.randomUUID(), error);
    return redirect(`/t?sign_in=unavailable`);
  }
}
