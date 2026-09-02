import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizeUsername } from "../services/user.js";

export const USER_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const USER_COOKIE_DOMAIN = "openmarket.user.v1";
const SHA256_SIGNATURE_BYTES = 32;
const SHA256_BASE64URL_LENGTH = 43;
const MAX_ENCODED_PAYLOAD_LENGTH = 1024;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+(?![\s\S])/;
const MIN_COOKIE_SECRET_BYTES = 32;
const SECRET_PLACEHOLDER_PATTERN =
  /(?:change[-_ ]?me|replace[-_ ]?me|your[-_ ]?secret|test[-_ ]?secret|placeholder|example)/i;

export interface UserCookiePayload {
  username: string;
  issuedAt: number;
}

type SecretEnvironment = Readonly<Record<string, string | undefined>>;

export function requireCookieSecret(secret: string, name: string): Buffer {
  if (
    typeof secret !== "string" ||
    !BASE64URL_PATTERN.test(secret) ||
    SECRET_PLACEHOLDER_PATTERN.test(secret)
  ) {
    throw new Error(`${name} must be canonical base64url encoding at least 32 random bytes.`);
  }

  const secretBytes = Buffer.from(secret, "base64url");
  if (
    secretBytes.length < MIN_COOKIE_SECRET_BYTES ||
    secretBytes.toString("base64url") !== secret ||
    secretBytes.every((byte) => byte === secretBytes[0]) ||
    SECRET_PLACEHOLDER_PATTERN.test(secretBytes.toString("utf8"))
  ) {
    throw new Error(`${name} must be canonical base64url encoding at least 32 random bytes.`);
  }

  return secretBytes;
}

function requireTimestamp(timestamp: number): void {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new RangeError("Cookie issued timestamp must be a non-negative safe integer.");
  }
}

export function getUserCookieSecret(environment: SecretEnvironment = process.env): string {
  const secret = environment.USER_COOKIE_SECRET;
  requireCookieSecret(secret ?? "", "USER_COOKIE_SECRET");
  return secret as string;
}

export function signCookiePayload(payload: object, secret: string, domain: string): string {
  const secretBytes = requireCookieSecret(secret, "Cookie secret");
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secretBytes)
    .update(domain)
    .update(".")
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

export function verifyCookiePayload(
  cookieValue: string,
  secret: string,
  domain: string,
): unknown | null {
  const secretBytes = requireCookieSecret(secret, "Cookie secret");
  if (typeof cookieValue !== "string") {
    return null;
  }

  const parts = cookieValue.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [encodedPayload, encodedSignature] = parts;
  if (
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    encodedPayload.length === 0 ||
    encodedPayload.length > MAX_ENCODED_PAYLOAD_LENGTH ||
    encodedSignature.length !== SHA256_BASE64URL_LENGTH ||
    !BASE64URL_PATTERN.test(encodedPayload) ||
    !BASE64URL_PATTERN.test(encodedSignature)
  ) {
    return null;
  }

  const suppliedSignature = Buffer.from(encodedSignature, "base64url");
  if (
    suppliedSignature.length !== SHA256_SIGNATURE_BYTES ||
    suppliedSignature.toString("base64url") !== encodedSignature
  ) {
    return null;
  }

  const expectedSignature = createHmac("sha256", secretBytes)
    .update(domain)
    .update(".")
    .update(encodedPayload)
    .digest();
  if (!timingSafeEqual(suppliedSignature, expectedSignature)) {
    return null;
  }

  const payloadBytes = Buffer.from(encodedPayload, "base64url");
  if (payloadBytes.toString("base64url") !== encodedPayload) {
    return null;
  }

  try {
    return JSON.parse(payloadBytes.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function isExactUserPayload(payload: unknown): payload is UserCookiePayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return false;
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    keys.length === 2 &&
    keys[0] === "issuedAt" &&
    keys[1] === "username" &&
    typeof record.username === "string" &&
    normalizeUsernameSafely(record.username) === record.username &&
    Number.isSafeInteger(record.issuedAt) &&
    (record.issuedAt as number) >= 0
  );
}

function normalizeUsernameSafely(username: string): string | null {
  try {
    return normalizeUsername(username);
  } catch {
    return null;
  }
}

export function signUserCookie(username: string, secret: string, issuedAt = Date.now()): string {
  const normalizedUsername = normalizeUsername(username);
  requireTimestamp(issuedAt);
  return signCookiePayload({ username: normalizedUsername, issuedAt }, secret, USER_COOKIE_DOMAIN);
}

export function verifyUserCookie(
  cookieValue: string,
  secret: string,
  now = Date.now(),
): UserCookiePayload | null {
  if (!Number.isSafeInteger(now) || now < 0) {
    return null;
  }

  const payload = verifyCookiePayload(cookieValue, secret, USER_COOKIE_DOMAIN);
  if (!isExactUserPayload(payload)) {
    return null;
  }

  const age = now - payload.issuedAt;
  if (age < 0 || age >= USER_COOKIE_MAX_AGE_MS) {
    return null;
  }

  return payload;
}
