import { parseMutationBody, withMutationRoute } from "../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../lib/api/response.js";
import { usernameInputSchema } from "../../../lib/api/schemas.js";
import { USER_COOKIE_NAME } from "../../../lib/auth/current-user.js";
import {
  getUserCookieSecret,
  signUserCookie,
  USER_COOKIE_MAX_AGE_MS,
} from "../../../lib/auth/user-cookie.js";
import { createOrResumeUser } from "../../../lib/services/user.js";

export const runtime = "nodejs";

function userCookie(value: string): string {
  const attributes = [
    `${USER_COOKIE_NAME}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(USER_COOKIE_MAX_AGE_MS / 1_000)}`,
  ];
  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    const input = await parseMutationBody(request, usernameInputSchema, 1_024);
    const user = await createOrResumeUser(context.db, input.username);
    const cookieValue = signUserCookie(user.username_normalized, getUserCookieSecret());

    return jsonSuccess(
      {
        userId: user.id,
        username: user.username,
        cash_balance_cents: user.cash_balance_cents,
      },
      {
        requestId: context.requestId,
        headers: { "Set-Cookie": userCookie(cookieValue) },
      },
    );
  });
}
