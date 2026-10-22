import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  beginAuthorization,
  fetchXProfile,
  originalXAvatarUrl,
  safeReturnPath,
  verifyAuthorizationState,
  X_TOKEN_URL,
  XSignInError,
  xClientConfig,
} from "../../src/lib/auth/x-oauth.js";

const CONFIG = {
  clientId: "client-id",
  clientSecret: null,
  redirectUri: "https://openmarket.systems/api/t/auth/x/callback",
};

describe("X OAuth 2.0 PKCE", () => {
  it("derives the redirect from APP_ORIGIN and stays off without a client id", () => {
    expect(xClientConfig({ APP_ORIGIN: "https://openmarket.systems" })).toBeNull();
    expect(xClientConfig({ X_CLIENT_ID: "abc", APP_ORIGIN: "https://openmarket.systems" })).toEqual(
      {
        clientId: "abc",
        clientSecret: null,
        redirectUri: "https://openmarket.systems/api/t/auth/x/callback",
      },
    );
  });

  it("only returns to same-site pages", () => {
    expect(safeReturnPath("/t/q/anthropic-s1-arr")).toBe("/t/q/anthropic-s1-arr");
    expect(safeReturnPath("/t")).toBe("/t");
    expect(safeReturnPath("/")).toBe("/");
    expect(safeReturnPath("/portfolio")).toBe("/portfolio");
    expect(safeReturnPath("/m/openai?range=1d")).toBe("/m/openai?range=1d");
    expect(safeReturnPath("//evil.example/t")).toBe("/t");
    expect(safeReturnPath("/\\evil.example")).toBe("/t");
    expect(safeReturnPath("https://evil.example/t")).toBe("/t");
    expect(safeReturnPath("/api/t/auth/logout")).toBe("/t");
    expect(safeReturnPath("/t/signin?return=/")).toBe("/t");
    expect(safeReturnPath("/m/x\r\nSet-Cookie:a=b")).toBe("/t");
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
    expect(verifyAuthorizationState(`${stateCookie}.sig`, state, now)).toBeNull();
    expect(verifyAuthorizationState(null, state, now)).toBeNull();
  });

  it("re-sanitizes a planted return path and rejects a planted cookie's foreign state", () => {
    const now = 1_700_000_000_000;
    const planted = (payload: object) => Buffer.from(JSON.stringify(payload)).toString("base64url");
    const state = "s".repeat(43);
    const verified = verifyAuthorizationState(
      planted({ state, verifier: "v".repeat(43), returnTo: "//evil.example", issuedAt: now }),
      state,
      now,
    );
    expect(verified?.returnTo).toBe("/t");
    expect(
      verifyAuthorizationState(
        planted({ state, verifier: "v".repeat(43), returnTo: "/t", issuedAt: now, extra: 1 }),
        state,
        now,
      ),
    ).toBeNull();
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
          profile_image_url: "https://pbs.twimg.com/profile_images/17/Abc_normal.jpg",
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
      profileImageUrl: "https://pbs.twimg.com/profile_images/17/Abc.jpg",
      verified: true,
      createdAt: new Date("2012-03-04T05:06:07.000Z"),
    });
  });

  it("bounds both X requests with a timeout and preserves missing creation dates", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      signals.push(init?.signal as AbortSignal);
      return String(input) === X_TOKEN_URL
        ? Response.json({ access_token: "token", token_type: "bearer" })
        : Response.json({ data: { id: "123", username: "Forecaster", name: "Forecaster" } });
    });
    expect((await fetchXProfile(CONFIG, "code", "verifier", fetchImpl)).createdAt).toBeNull();
    expect(signals).toHaveLength(2);
  });

  it("names X's original avatar upload, not the 48-pixel thumbnail", () => {
    expect(originalXAvatarUrl("https://pbs.twimg.com/profile_images/17/Abc_normal.jpg")).toBe(
      "https://pbs.twimg.com/profile_images/17/Abc.jpg",
    );
    expect(originalXAvatarUrl("https://pbs.twimg.com/profile_images/17/Abc_normal")).toBe(
      "https://pbs.twimg.com/profile_images/17/Abc",
    );
    expect(originalXAvatarUrl("https://pbs.twimg.com/profile_images/17/my_normal_pic.png")).toBe(
      "https://pbs.twimg.com/profile_images/17/my_normal_pic.png",
    );
    expect(
      originalXAvatarUrl(
        "https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png",
      ),
    ).toBe("https://abs.twimg.com/sticky/default_profile_images/default_profile.png");
  });

  it("fails closed on an X error", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 400 }));
    const failure = fetchXProfile(CONFIG, "code", "verifier", fetchImpl as typeof fetch);
    await expect(failure).rejects.toBeInstanceOf(XSignInError);
    await expect(failure).rejects.toThrow(/^X token exchange failed \(400\)\.$/);
  });

  it("names X's problem fields on a refused profile lookup, and nothing else", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === X_TOKEN_URL) {
        return Response.json({ access_token: "secret-access-token", token_type: "bearer" });
      }
      return Response.json(
        {
          title: "Client Forbidden",
          detail:
            "This request must be made using an approved developer account\nattached to a Project.",
          type: "https://api.twitter.com/2/problems/client-forbidden",
          reason: "client-not-enrolled",
          client_id: "client-id",
          access_token: "secret-access-token",
        },
        { status: 403 },
      );
    });
    const failure = fetchXProfile(CONFIG, "code", "verifier", fetchImpl as typeof fetch);
    await expect(failure).rejects.toThrow(
      'X profile lookup failed (403). title="Client Forbidden" detail="This request must be made using an approved developer account attached to a Project." type="https://api.twitter.com/2/problems/client-forbidden" reason="client-not-enrolled"',
    );
    await expect(failure).rejects.not.toThrow(/secret-access-token|client_id/);
  });

  it("reads only string problem fields from a refused token exchange, capped in length", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { title: "x".repeat(1_000), reason: 42, error: "invalid_grant", code: "code" },
        { status: 401 },
      ),
    );
    const failure = fetchXProfile(CONFIG, "code", "verifier", fetchImpl as typeof fetch);
    await expect(failure).rejects.toThrow(
      `X token exchange failed (401). title="${"x".repeat(300)}"`,
    );
    await expect(failure).rejects.not.toThrow(/reason|invalid_grant/);
  });
});
