import {
  requireCookieSecret,
  signCookiePayload,
  verifyCookiePayload,
} from "./user-cookie.js";

const ADMIN_COOKIE_DOMAIN = "openmarket.admin.v1";

export const ADMIN_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

export interface AdminCookiePayload {
  issuedAt: number;
}

type SecretEnvironment = Readonly<Record<string, string | undefined>>;

export function getAdminCookieSecret(
  environment: SecretEnvironment = process.env,
): string {
  const secret = environment.ADMIN_COOKIE_SECRET;
  requireCookieSecret(secret ?? "", "ADMIN_COOKIE_SECRET");
  return secret as string;
}

export function signAdminCookie(
  secret: string,
  issuedAt = Date.now(),
): string {
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
    throw new RangeError("Cookie issued timestamp must be a non-negative safe integer.");
  }
  return signCookiePayload({ issuedAt }, secret, ADMIN_COOKIE_DOMAIN);
}

export function verifyAdminCookie(
  cookieValue: string,
  secret: string,
  now = Date.now(),
): AdminCookiePayload | null {
  if (!Number.isSafeInteger(now) || now < 0) {
    return null;
  }

  const payload = verifyCookiePayload(cookieValue, secret, ADMIN_COOKIE_DOMAIN);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 1 ||
    keys[0] !== "issuedAt" ||
    !Number.isSafeInteger(record.issuedAt) ||
    (record.issuedAt as number) < 0
  ) {
    return null;
  }

  const issuedAt = record.issuedAt as number;
  const age = now - issuedAt;
  if (age < 0 || age >= ADMIN_COOKIE_MAX_AGE_MS) {
    return null;
  }

  return { issuedAt };
}
