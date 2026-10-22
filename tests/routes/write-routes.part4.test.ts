import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import { TOURNAMENT_SESSION_COOKIE } from "../../src/lib/auth/tournament-session.js";
import type { Database } from "../../src/lib/db/schema.js";

const mocks = vi.hoisted(() => ({
  getRuntimeDatabase: vi.fn(),
  ensurePaperAccount: vi.fn(),
  quoteMarket: vi.fn(),
  executeTrade: vi.fn(),
  removeComment: vi.fn(),
  consumeRateLimit: vi.fn(),
  consumeNetworkRateLimit: vi.fn(),
  assertNetworkRateLimitAvailable: vi.fn(),
}));

vi.mock("../../src/lib/db/runtime.js", () => ({
  getRuntimeDatabase: mocks.getRuntimeDatabase,
}));
vi.mock("../../src/lib/services/user.js", () => ({
  ensurePaperAccount: mocks.ensurePaperAccount,
}));
vi.mock("../../src/lib/services/quote.js", () => ({
  quoteMarket: mocks.quoteMarket,
}));
vi.mock("../../src/lib/services/execute-trade.js", () => ({
  executeTrade: mocks.executeTrade,
}));
vi.mock("../../src/lib/services/remove-comment.js", () => ({
  removeComment: mocks.removeComment,
}));
vi.mock("../../src/lib/services/rate-limit.js", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  consumeNetworkRateLimit: mocks.consumeNetworkRateLimit,
  assertNetworkRateLimitAvailable: mocks.assertNetworkRateLimitAvailable,
  RATE_LIMIT_NETWORK_POLICIES: {
    quote: { limit: 600, windowMs: 60_000 },
    trade: { limit: 120, windowMs: 60_000 },
  },
}));

import { POST as removeCommentRoute } from "../../src/app/api/admin/comments/[commentId]/remove/route.js";
import { POST as quoteRoute } from "../../src/app/api/quote/route.js";
import { POST as tradeRoute } from "../../src/app/api/trade/route.js";

const APP_ORIGIN = "https://app.openmarket.test";
const COMMENT_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

/** The session row and the identities behind it, as the tournament tables return them. */
const sessionLookup = {
  select: vi.fn(),
  where: vi.fn(),
  executeTakeFirst: vi.fn(),
};
const identityLookup = {
  select: vi.fn(),
  where: vi.fn(),
  execute: vi.fn(),
};

const fakeDatabase = {
  selectFrom: vi.fn((table: string) =>
    table === "tournament_identities" ? identityLookup : sessionLookup,
  ),
} as unknown as Kysely<Database>;

type PostRoute = (request: Request) => Promise<Response>;

function mutationRequest(path: string, body: unknown, headers: HeadersInit = {}): Request {
  return new Request(`${APP_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: APP_ORIGIN,
      ...Object.fromEntries(new Headers(headers)),
    },
    body: JSON.stringify(body),
  });
}

function sessionCookieHeader(): string {
  return `${TOURNAMENT_SESSION_COOKIE}=${"t".repeat(43)}`;
}

const removeRoute: PostRoute = (request) =>
  removeCommentRoute(request, { params: Promise.resolve({ commentId: COMMENT_ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
  vi.stubEnv("TOURNAMENT_ADMIN_X_IDS", "1234567");
  mocks.getRuntimeDatabase.mockReturnValue(fakeDatabase);
  mocks.ensurePaperAccount.mockResolvedValue("user-1");
  mocks.consumeRateLimit.mockResolvedValue(undefined);
  mocks.consumeNetworkRateLimit.mockResolvedValue(undefined);
  mocks.assertNetworkRateLimitAvailable.mockResolvedValue(undefined);
  for (const lookup of [sessionLookup, identityLookup]) {
    lookup.select.mockReturnValue(lookup);
    lookup.where.mockReturnValue(lookup);
  }
  sessionLookup.executeTakeFirst.mockResolvedValue({
    user_id: "tournament-user-1",
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  identityLookup.execute.mockResolvedValue([{ provider: "x", provider_user_id: "7654321" }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Part 4 mutation request boundary", () => {
  const routes: readonly [string, PostRoute][] = [
    ["/api/quote", quoteRoute],
    ["/api/trade", tradeRoute],
    [`/api/admin/comments/${COMMENT_ID}/remove`, removeRoute],
  ];

  for (const [path, route] of routes) {
    it(`${path} rejects non-exact JSON content types before database access`, async () => {
      const request = new Request(`${APP_ORIGIN}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          origin: APP_ORIGIN,
        },
        body: "{}",
      });

      const response = await route(request);

      expect(response.status).toBe(400);
      expect(mocks.getRuntimeDatabase).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INVALID_INPUT",
          message: "Content-Type must be exactly application/json.",
          details: {},
        },
      });
    });

    it(`${path} rejects absent and suffix-matched origins`, async () => {
      const absentOriginResponse = await route(
        new Request(`${APP_ORIGIN}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      const suffixOriginResponse = await route(
        new Request(`${APP_ORIGIN}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: `${APP_ORIGIN}.attacker.test`,
          },
          body: "{}",
        }),
      );

      expect(absentOriginResponse.status).toBe(400);
      expect(suffixOriginResponse.status).toBe(400);
      expect(mocks.getRuntimeDatabase).not.toHaveBeenCalled();
      await expect(absentOriginResponse.json()).resolves.toMatchObject({
        error: { code: "INVALID_INPUT" },
      });
      await expect(suffixOriginResponse.json()).resolves.toMatchObject({
        error: { code: "INVALID_INPUT" },
      });
    });
  }

  it("rejects malformed JSON and unknown identity fields with stable errors", async () => {
    const malformed = await quoteRoute(
      new Request(`${APP_ORIGIN}/api/quote`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: APP_ORIGIN,
        },
        body: "{",
      }),
    );
    const injectedIdentity = await tradeRoute(
      mutationRequest(
        "/api/trade",
        {
          market_id: "0f8a0c1e-6c1d-4f7a-9d2b-3c4e5f607182",
          action: "buy",
          side: "yes",
          strike_index: 0,
          quantity: 2,
          max_cost_usd: "2.00",
          idempotency_key: "1c97cdcb-980b-48b4-9622-0d296c6a98a8",
          user_id: "attacker",
        },
        { cookie: sessionCookieHeader() },
      ),
    );

    expect(malformed.status).toBe(400);
    expect(injectedIdentity.status).toBe(400);
    expect(mocks.quoteMarket).not.toHaveBeenCalled();
    expect(mocks.executeTrade).not.toHaveBeenCalled();
    await expect(injectedIdentity.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });
});

describe("Part 4 quote route", () => {
  it("allows anonymous buy quotes", async () => {
    const quote = { market_id: "market-1", action: "buy", quantity: 2 };
    mocks.quoteMarket.mockResolvedValue(quote);
    const input = {
      market_id: "0f8a0c1e-6c1d-4f7a-9d2b-3c4e5f607182",
      action: "buy",
      side: "yes",
      strike_index: 0,
      quantity: 2,
    } as const;

    const response = await quoteRoute(mutationRequest("/api/quote", input));

    expect(response.status).toBe(200);
    expect(mocks.quoteMarket).toHaveBeenCalledWith(fakeDatabase, input, undefined);
    await expect(response.json()).resolves.toEqual(quote);
  });

  it("requires a tournament session for sells and uses only its paper account", async () => {
    const input = {
      market_id: "0f8a0c1e-6c1d-4f7a-9d2b-3c4e5f607182",
      action: "sell",
      side: "no",
      strike_index: 0,
      quantity: 1,
    } as const;
    mocks.quoteMarket.mockResolvedValue({ action: "sell", quantity: 1 });

    const missingResponse = await quoteRoute(mutationRequest("/api/quote", input));
    const authenticatedResponse = await quoteRoute(
      mutationRequest("/api/quote", input, {
        cookie: sessionCookieHeader(),
        "x-user-id": "attacker",
      }),
    );

    expect(missingResponse.status).toBe(401);
    expect(authenticatedResponse.status).toBe(200);
    expect(mocks.ensurePaperAccount).toHaveBeenCalledWith(fakeDatabase, "tournament-user-1");
    expect(mocks.quoteMarket).toHaveBeenCalledTimes(1);
    expect(mocks.quoteMarket).toHaveBeenCalledWith(fakeDatabase, input, "user-1");
    await expect(missingResponse.json()).resolves.toMatchObject({
      error: { code: "USER_REQUIRED" },
    });
  });
});

describe("Part 4 trade route", () => {
  const tradeInput = {
    market_id: "0f8a0c1e-6c1d-4f7a-9d2b-3c4e5f607182",
    action: "buy",
    side: "yes",
    strike_index: 0,
    quantity: 2,
    max_cost_usd: "2.00",
    idempotency_key: "1c97cdcb-980b-48b4-9622-0d296c6a98a8",
  } as const;

  it("requires a tournament session and marks stored idempotent replays", async () => {
    const storedResult = {
      trade_id: "trade-1",
      idempotency_key: tradeInput.idempotency_key,
      cash_balance_cents: "9999800",
    };
    mocks.executeTrade.mockResolvedValue({
      result: storedResult,
      replayed: true,
    });

    const missingResponse = await tradeRoute(mutationRequest("/api/trade", tradeInput));
    const replayResponse = await tradeRoute(
      mutationRequest("/api/trade", tradeInput, {
        cookie: sessionCookieHeader(),
        "x-user-id": "attacker",
      }),
    );

    expect(missingResponse.status).toBe(401);
    expect(replayResponse.status).toBe(200);
    expect(replayResponse.headers.get("idempotent-replayed")).toBe("true");
    expect(mocks.executeTrade).toHaveBeenCalledTimes(1);
    expect(mocks.executeTrade).toHaveBeenCalledWith(fakeDatabase, "user-1", tradeInput);
    await expect(replayResponse.json()).resolves.toEqual(storedResult);
  });

  it("rejects a body over the route cap before executing anything", async () => {
    const response = await tradeRoute(
      mutationRequest(
        "/api/trade",
        { ...tradeInput, padding: "a".repeat(5_000) },
        { cookie: sessionCookieHeader() },
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(mocks.executeTrade).not.toHaveBeenCalled();
  });

  it("preserves authoritative PRICE_MOVED details", async () => {
    const movedPriceDetails = {
      cash_amount_cents: "205",
      shares: 2,
    };
    mocks.executeTrade.mockRejectedValue(
      new ServiceError(
        "PRICE_MOVED",
        "Price moved. New cost: $2.05. Confirm trade?",
        movedPriceDetails,
      ),
    );

    const response = await tradeRoute(
      mutationRequest("/api/trade", tradeInput, {
        cookie: sessionCookieHeader(),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRICE_MOVED",
        message: "Price moved. New cost: $2.05. Confirm trade?",
        details: movedPriceDetails,
      },
    });
  });
});

describe("Part 4 admin comment moderation", () => {
  it("requires a session whose identity is on the tournament admin allowlist", async () => {
    const removed = { id: COMMENT_ID, removedAt: "2026-10-21T00:00:00.000Z" };
    mocks.removeComment.mockResolvedValue(removed);
    const request = () =>
      mutationRequest(
        `/api/admin/comments/${COMMENT_ID}/remove`,
        {},
        {
          cookie: sessionCookieHeader(),
        },
      );

    const signedOut = await removeRoute(
      mutationRequest(`/api/admin/comments/${COMMENT_ID}/remove`, {}),
    );
    const notAdmin = await removeRoute(request());
    identityLookup.execute.mockResolvedValue([{ provider: "x", provider_user_id: "1234567" }]);
    const admin = await removeRoute(request());

    expect(signedOut.status).toBe(401);
    expect(notAdmin.status).toBe(401);
    await expect(notAdmin.json()).resolves.toMatchObject({ error: { code: "ADMIN_REQUIRED" } });
    expect(admin.status).toBe(200);
    expect(mocks.removeComment).toHaveBeenCalledTimes(1);
    expect(mocks.removeComment).toHaveBeenCalledWith(fakeDatabase, COMMENT_ID);
    await expect(admin.json()).resolves.toEqual(removed);
  });
});

it("rejects extraneous quote query parameters before executing", async () => {
  const response = await quoteRoute(
    mutationRequest("/api/quote?user_id=secret", {
      market_id: "0f8a0c1e-6c1d-4f7a-9d2b-3c4e5f607182",
      action: "buy",
      side: "yes",
      strike_index: 0,
      quantity: 2,
    }),
  );
  expect(response.status).toBe(400);
  expect(mocks.quoteMarket).not.toHaveBeenCalled();
});
