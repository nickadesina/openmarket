import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import { getUserCookieSecret, signCookiePayload, verifyCookiePayload } from "./user-cookie.js";

/**
 * X OAuth 2.0 Authorization Code with PKCE, user context. Read scopes only;
 * no offline.access, so the access token is discarded after the profile fetch.
 */
export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_PROFILE_URL =
  "https://api.x.com/2/users/me?user.fields=profile_image_url,verified,created_at";
export const X_SCOPES = ["users.read", "tweet.read"] as const;

export const OAUTH_STATE_COOKIE = "openmarket_tournament_oauth";
export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_STATE_DOMAIN = "openmarket.tournament.oauth.v1";

type Environment = Readonly<Record<string, string | undefined>>;

export interface XClientConfig {
  readonly clientId: string;
  readonly clientSecret: string | null;
  readonly redirectUri: string;
}

/** Null when X sign-in is not configured for this deployment. */
export function xClientConfig(environment: Environment = process.env): XClientConfig | null {
  const clientId = environment.X_CLIENT_ID?.trim();
  const origin = environment.APP_ORIGIN?.trim();
  const redirectUri =
    environment.X_REDIRECT_URI?.trim() ||
    (origin === undefined || origin === ""
      ? undefined
      : `${new URL(origin).origin}/api/t/auth/x/callback`);
  if (clientId === undefined || clientId === "" || redirectUri === undefined) return null;
  const secret = environment.X_CLIENT_SECRET?.trim();
  return {
    clientId,
    clientSecret: secret === undefined || secret === "" ? null : secret,
    redirectUri,
  };
}

/** Only same-site tournament paths survive the round trip through X. */
export function safeReturnPath(value: string | null | undefined): string {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !/^\/t(?:[/?#]|$)/.test(value) ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/t";
  }
  return value;
}

interface OAuthState {
  readonly state: string;
  readonly verifier: string;
  readonly returnTo: string;
  readonly issuedAt: number;
}

const oauthStateSchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    returnTo: z.string().max(512),
    issuedAt: z.number().int().nonnegative(),
  })
  .strict();

export interface Authorization {
  readonly url: string;
  readonly stateCookie: string;
}

export function beginAuthorization(
  config: XClientConfig,
  returnTo: string,
  now = Date.now(),
): Authorization {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", X_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  const payload: OAuthState = {
    state,
    verifier,
    returnTo: safeReturnPath(returnTo),
    issuedAt: now,
  };
  return {
    url: url.toString(),
    stateCookie: signCookiePayload(payload, getUserCookieSecret(), OAUTH_STATE_DOMAIN),
  };
}

/** Verifies the signed state cookie against the state X echoed back. */
export function verifyAuthorizationState(
  cookieValue: string | null,
  returnedState: string | null,
  now = Date.now(),
): OAuthState | null {
  if (cookieValue === null || returnedState === null) return null;
  const parsed = oauthStateSchema.safeParse(
    verifyCookiePayload(cookieValue, getUserCookieSecret(), OAUTH_STATE_DOMAIN),
  );
  if (!parsed.success) return null;
  const age = now - parsed.data.issuedAt;
  if (age < 0 || age >= OAUTH_STATE_MAX_AGE_MS || parsed.data.state !== returnedState) return null;
  return parsed.data;
}

export interface XProfile {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly profileImageUrl: string | null;
  readonly verified: boolean;
  readonly createdAt: Date | null;
}

const tokenSchema = z.object({ access_token: z.string().min(1), token_type: z.string() });
const profileSchema = z.object({
  data: z.object({
    id: z.string().regex(/^\d{1,30}$/),
    username: z.string().regex(/^[A-Za-z0-9_]{1,50}$/),
    name: z.string().max(200),
    profile_image_url: z.string().url().optional(),
    verified: z.boolean().optional(),
    created_at: z.string().optional(),
  }),
});

export class XSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XSignInError";
  }
}

/** Exchanges the code, fetches the public profile, and drops the token. */
export async function fetchXProfile(
  config: XClientConfig,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<XProfile> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (config.clientSecret !== null) {
    headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  }
  const tokenResponse = await fetchImpl(X_TOKEN_URL, {
    method: "POST",
    headers,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
      client_id: config.clientId,
    }).toString(),
  });
  if (!tokenResponse.ok)
    throw new XSignInError(`X token exchange failed (${tokenResponse.status}).`);
  const token = tokenSchema.safeParse(await tokenResponse.json());
  if (!token.success) throw new XSignInError("X returned an unreadable token.");

  const profileResponse = await fetchImpl(X_PROFILE_URL, {
    headers: { Authorization: `Bearer ${token.data.access_token}` },
  });
  if (!profileResponse.ok)
    throw new XSignInError(`X profile lookup failed (${profileResponse.status}).`);
  const profile = profileSchema.safeParse(await profileResponse.json());
  if (!profile.success) throw new XSignInError("X returned an unreadable profile.");

  const { data } = profile.data;
  const createdAt = data.created_at === undefined ? null : new Date(data.created_at);
  return {
    id: data.id,
    username: data.username,
    name: data.name,
    profileImageUrl: data.profile_image_url ?? null,
    verified: data.verified ?? false,
    createdAt: createdAt === null || Number.isNaN(createdAt.getTime()) ? null : createdAt,
  };
}
