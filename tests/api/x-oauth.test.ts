import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginAuthorization,
  fetchXProfile,
  safeReturnPath,
  verifyAuthorizationState,
  X_TOKEN_URL,
  XSignInError,
  xClientConfig,
} from "../../src/lib/auth/x-oauth.js";

const SECRET = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString(
  "base64url",
);
const CONFIG = {
  clientId: "client-id",
  clientSecret: null,
  redirectUri: "https://openmkt.vercel.app/api/t/auth/x/callback",
};

describe("X OAuth 2.0 PKCE", () => {
  beforeEach(() => vi.stubEnv("USER_COOKIE_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it("derives the redirect from APP_ORIGIN and stays off without a client id", () => {
    expect(xClientConfig({ APP_ORIGIN: "https://openmkt.vercel.app" })).toBeNull();
    expect(xClientConfig({ X_CLIENT_ID: "abc", APP_ORIGIN: "https://openmkt.vercel.app" })).toEqual(
      {
        clientId: "abc",
        clientSecret: null,
        redirectUri: "https://openmkt.vercel.app/api/t/auth/x/callback",
      },
    );
  });

  it("only returns to tournament paths", () => {
    expect(safeReturnPath("/t/q/anthropic-s1-arr")).toBe("/t/q/anthropic-s1-arr");
    expect(safeReturnPath("/t")).toBe("/t");
    expect(safeReturnPath("//evil.example/t")).toBe("/t");
    expect(safeReturnPath("https://evil.example/t")).toBe("/t");
    expect(safeReturnPath("/portfolio")).toBe("/t");
    expect(safeReturnPath("/tx")).toBe("/t");
    expect(safeReturnPath(null)).toBe("/t");
  });

  it("asks for read scopes with an S256 challenge and verifies the echoed state", () => {
    const now = 1_700_000_000_000;
    const { url, stateCookie } = beginAuthorization(CONFIG, "/t/leaderboard", now);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe("users.read tweet.read");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    const state = parsed.searchParams.get("state")!;

    const verified = verifyAuthorizationState(stateCookie, state, now + 1_000)!;
    expect(verified.returnTo).toBe("/t/leaderboard");
    expect(createHash("sha256").update(verified.verifier).digest("base64url")).toBe(
      parsed.searchParams.get("code_challenge"),
    );

    expect(verifyAuthorizationState(stateCookie, "x".repeat(43), now)).toBeNull();
    expect(verifyAuthorizationState(stateCookie, state, now + 11 * 60_000)).toBeNull();
    expect(verifyAuthorizationState(`${stateCookie}x`, state, now)).toBeNull();
    expect(verifyAuthorizationState(null, state, now)).toBeNull();
  });

  it("exchanges the code and reads the public profile", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === X_TOKEN_URL) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("code_verifier")).toBe("verifier");
        expect(body.get("grant_type")).toBe("authorization_code");
        return Response.json({ access_token: "token", token_type: "bearer" });
      }
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
      return Response.json({
        data: {
          id: "123456",
          username: "Forecaster",
          name: "A Forecaster",
          verified: true,
          created_at: "2012-03-04T05:06:07.000Z",
        },
      });
    });
    const profile = await fetchXProfile(CONFIG, "code", "verifier", fetchImpl as typeof fetch);
    expect(profile).toEqual({
      id: "123456",
      username: "Forecaster",
      name: "A Forecaster",
      profileImageUrl: null,
      verified: true,
      createdAt: new Date("2012-03-04T05:06:07.000Z"),
    });
  });

  it("fails closed on an X error", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 400 }));
    await expect(
      fetchXProfile(CONFIG, "code", "verifier", fetchImpl as typeof fetch),
    ).rejects.toBeInstanceOf(XSignInError);
  });
});
