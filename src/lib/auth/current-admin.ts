import { ServiceError } from "../api/errors.js";
import {
  type AdminCookiePayload,
  getAdminCookieSecret,
  verifyAdminCookie,
} from "./admin-cookie.js";

export const ADMIN_COOKIE_NAME = "openmarket_admin";

function adminRequired(): ServiceError {
  return new ServiceError("ADMIN_REQUIRED", "A valid signed admin cookie is required.");
}

function readAdminCookie(request: Request): string {
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader === null) {
    throw adminRequired();
  }

  let cookieValue: string | undefined;
  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const name = segment.slice(0, separator).trim();
    if (name !== ADMIN_COOKIE_NAME) {
      continue;
    }
    if (cookieValue !== undefined) {
      throw adminRequired();
    }
    cookieValue = segment.slice(separator + 1).trim();
  }

  if (cookieValue === undefined || cookieValue.length === 0) {
    throw adminRequired();
  }
  return cookieValue;
}

export function requireCurrentAdmin(request: Request): AdminCookiePayload {
  const cookieValue = readAdminCookie(request);
  const payload = verifyAdminCookie(cookieValue, getAdminCookieSecret());
  if (payload === null) {
    throw adminRequired();
  }
  return payload;
}
