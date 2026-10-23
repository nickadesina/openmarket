import { createHash, randomBytes } from "node:crypto";

import type { Kysely } from "kysely";

import { ServiceError } from "../api/errors.js";
import {
  adminKey,
  TOURNAMENT_SESSION_MAX_AGE_MS,
  TOURNAMENT_SESSION_REFRESH_MS,
  tournamentAdminIds,
} from "../config/tournament.js";
import type { Database } from "../db/schema.js";

export const TOURNAMENT_SESSION_COOKIE = "openmarket_tournament";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Reads one cookie by name; a duplicated name reads as absent. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (header === null) return null;
  let value: string | null = null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0 || segment.slice(0, separator).trim() !== name) continue;
    if (value !== null) return null;
    value = segment.slice(separator + 1).trim();
  }
  return value === null || value.length === 0 ? null : value;
}

function sessionId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function cookieHeader(name: string, value: string, maxAgeMs: number): string {
  const attributes = [
    `${name}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1_000))}`,
  ];
  if (process.env.NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}

export function sessionCookie(token: string): string {
  return cookieHeader(TOURNAMENT_SESSION_COOKIE, token, TOURNAMENT_SESSION_MAX_AGE_MS);
}

export function clearedSessionCookie(): string {
  return cookieHeader(TOURNAMENT_SESSION_COOKIE, "", 0);
}

/** Opens a server-side session; the cookie carries the token, the table only its hash. */
export async function createTournamentSession(
  db: Kysely<Database>,
  userId: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db
    .insertInto("tournament_sessions")
    .values({
      id: sessionId(token),
      user_id: userId,
      expires_at: new Date(Date.now() + TOURNAMENT_SESSION_MAX_AGE_MS),
    })
    .execute();
  return token;
}

export interface TournamentSession {
  readonly userId: string;
  /** Set when the sliding expiry moved; the caller re-issues the cookie with it. */
  readonly refreshedToken: string | null;
}

export async function resolveTournamentSession(
  db: Kysely<Database>,
  request: Request,
  options: { readonly refresh?: boolean } = {},
): Promise<TournamentSession | null> {
  const token = readCookie(request, TOURNAMENT_SESSION_COOKIE);
  if (token === null || !TOKEN_PATTERN.test(token)) return null;
  const id = sessionId(token);
  const session = await db
    .selectFrom("tournament_sessions")
    .select(["user_id", "expires_at"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (session === undefined) return null;

  const now = Date.now();
  if (session.expires_at.getTime() <= now) {
    await db.deleteFrom("tournament_sessions").where("id", "=", id).execute();
    return null;
  }
  // Only a caller that reissues the browser cookie may slide the row.
  const remaining = session.expires_at.getTime() - now;
  if (
    !options.refresh ||
    TOURNAMENT_SESSION_MAX_AGE_MS - remaining < TOURNAMENT_SESSION_REFRESH_MS
  ) {
    return { userId: session.user_id, refreshedToken: null };
  }
  await db
    .updateTable("tournament_sessions")
    .set({ expires_at: new Date(now + TOURNAMENT_SESSION_MAX_AGE_MS) })
    .where("id", "=", id)
    .execute();
  return { userId: session.user_id, refreshedToken: token };
}

export async function requireTournamentUserId(
  db: Kysely<Database>,
  request: Request,
): Promise<string> {
  const session = await resolveTournamentSession(db, request);
  if (session === null) {
    throw new ServiceError("USER_REQUIRED", "Sign in to continue.");
  }
  return session.userId;
}

export async function destroyTournamentSession(
  db: Kysely<Database>,
  request: Request,
): Promise<void> {
  const token = readCookie(request, TOURNAMENT_SESSION_COOKIE);
  if (token === null || !TOKEN_PATTERN.test(token)) return;
  await db.deleteFrom("tournament_sessions").where("id", "=", sessionId(token)).execute();
}

export async function isTournamentAdmin(db: Kysely<Database>, userId: string): Promise<boolean> {
  const allowlist = tournamentAdminIds();
  if (allowlist.size === 0) return false;
  const identities = await db
    .selectFrom("tournament_identities")
    .select(["provider", "provider_user_id"])
    .where("user_id", "=", userId)
    .execute();
  return identities.some((identity) =>
    allowlist.has(adminKey(identity.provider, identity.provider_user_id)),
  );
}

/** Admin is an allowlist of X ids in config; the session supplies the identity. */
export async function requireTournamentAdmin(
  db: Kysely<Database>,
  request: Request,
): Promise<string> {
  const session = await resolveTournamentSession(db, request);
  if (session === null || !(await isTournamentAdmin(db, session.userId))) {
    throw new ServiceError("ADMIN_REQUIRED", "A tournament admin session is required.", {
      authenticated: session !== null,
    });
  }
  return session.userId;
}
