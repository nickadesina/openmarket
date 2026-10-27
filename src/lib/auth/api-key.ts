import { createHash, randomBytes } from "node:crypto";

import { ServiceError } from "../api/errors.js";

/**
 * Reference API keys (README D14, migration 010): `om_` and 43 base64url
 * characters of 32 random bytes. The key is shown once at creation; the
 * table holds only its SHA-256, which is enough for a 256-bit random secret.
 */
export const API_KEY_PREFIX = "om_";
const API_KEY_PATTERN = /^om_[A-Za-z0-9_-]{43}$/;

/** A new key's quota unless its creator sets one: ten times the public tier. */
export const DEFAULT_KEY_QUOTA_PER_MINUTE = 600;

/**
 * Key tiers (migration 018). A design-partner key is the free trial: the
 * default quota, expiring DESIGN_PARTNER_KEY_DAYS after creation (decided
 * 2026-10-26). A standard key never expires.
 */
export const API_KEY_TIERS = ["design_partner", "standard"] as const;
export type ApiKeyTier = (typeof API_KEY_TIERS)[number];
export const DESIGN_PARTNER_KEY_DAYS = 365;

export function isApiKeyTier(value: string): value is ApiKeyTier {
  return (API_KEY_TIERS as readonly string[]).includes(value);
}

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** `api_keys.key_hash`: the key's SHA-256, lowercase hex. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * The key a request presents as `Authorization: Bearer <key>`, or null when
 * it presents none. Any other Authorization value is refused, so a caller
 * who meant to use a key never silently lands in the public tier.
 */
export function bearerApiKey(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const match = /^Bearer (\S+)$/.exec(header.trim());
  if (match === null || !API_KEY_PATTERN.test(match[1]!)) {
    throw new ServiceError("API_KEY_INVALID", "The API key is not valid.");
  }
  return match[1]!;
}
