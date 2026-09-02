import type { Kysely } from "kysely";

import { ServiceError } from "../api/errors.js";
import type { Database } from "../db/schema.js";
import { getUserCookieSecret, verifyUserCookie } from "./user-cookie.js";

export const USER_COOKIE_NAME = "openmarket_user";

type DatabaseProvider = () => Kysely<Database>;

function userRequired(): ServiceError {
  return new ServiceError("USER_REQUIRED", "A valid signed user cookie is required.");
}

function readCookie(request: Request): string {
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader === null) {
    throw userRequired();
  }

  let cookieValue: string | undefined;
  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const name = segment.slice(0, separator).trim();
    if (name !== USER_COOKIE_NAME) {
      continue;
    }
    if (cookieValue !== undefined) {
      throw userRequired();
    }
    cookieValue = segment.slice(separator + 1).trim();
  }

  if (cookieValue === undefined || cookieValue.length === 0) {
    throw userRequired();
  }
  return cookieValue;
}

export async function requireCurrentUserId(
  request: Request,
  getDatabase: DatabaseProvider,
): Promise<string> {
  const cookieValue = readCookie(request);
  const payload = verifyUserCookie(cookieValue, getUserCookieSecret());
  if (payload === null) {
    throw userRequired();
  }

  const user = await getDatabase()
    .selectFrom("users")
    .select("id")
    .where("username_normalized", "=", payload.username)
    .executeTakeFirst();

  if (user === undefined) {
    throw userRequired();
  }
  return user.id;
}
