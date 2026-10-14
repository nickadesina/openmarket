import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import { signAdminCookie } from "../../src/lib/auth/admin-cookie.js";
import { signUserCookie, verifyUserCookie } from "../../src/lib/auth/user-cookie.js";
import type { Database } from "../../src/lib/db/schema.js";

const mocks = vi.hoisted(() => ({
  getRuntimeDatabase: vi.fn(),
  createOrResumeUser: vi.fn(),
  quoteMarket: vi.fn(),
  executeTrade: vi.fn(),
  seedMarket: vi.fn(),
  settleMarket: vi.fn(),
  getAdminPassphraseHash: vi.fn(),
  verifyAdminPassphrase: vi.fn(),
  consumeRateLimit: vi.fn(),
  consumeNetworkRateLimit: vi.fn(),
  assertNetworkRateLimitAvailable: vi.fn(),
}));

vi.mock("../../src/lib/db/runtime.js", () => ({
  getRuntimeDatabase: mocks.getRuntimeDatabase,
}));
vi.mock("../../src/lib/services/user.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/services/user.js")>();
  return { ...original, createOrResumeUser: mocks.createOrResumeUser };
});
vi.mock("../../src/lib/services/quote.js", () => ({
  quoteMarket: mocks.quoteMarket,
}));
vi.mock("../../src/lib/services/execute-trade.js", () => ({
  executeTrade: mocks.executeTrade,
}));
vi.mock("../../src/lib/services/seed-market.js", () => ({
  seedMarket: mocks.seedMarket,
}));
vi.mock("../../src/lib/services/settle-market.js", () => ({
  settleMarket: mocks.settleMarket,
}));
vi.mock("../../src/lib/auth/admin-passphrase.js", () => ({
  getAdminPassphraseHash: mocks.getAdminPassphraseHash,
  verifyAdminPassphrase: mocks.verifyAdminPassphrase,
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

import { POST as adminLoginRoute } from "../../src/app/api/admin/login/route.js";
import { POST as adminSeedRoute } from "../../src/app/api/admin/seed/route.js";
import { POST as adminSettleRoute } from "../../src/app/api/admin/settle/route.js";
import { POST as quoteRoute } from "../../src/app/api/quote/route.js";
import { POST as tradeRoute } from "../../src/app/api/trade/route.js";
import { POST as userRoute } from "../../src/app/api/user/route.js";

const APP_ORIGIN = "https://app.openmarket.test";
const USER_SECRET = Buffer.from(Array.from({ length: 32 }, (_unused, index) => index + 1)).toString(
  "base64url",
);
const ADMIN_SECRET = Buffer.from(
  Array.from({ length: 32 }, (_unused, index) => index + 65),
).toString("base64url");

const userLookup = {
  select: vi.fn(),
  where: vi.fn(),
  executeTakeFirst: vi.fn(),
};
userLookup.select.mockReturnValue(userLookup);
userLookup.where.mockReturnValue(userLookup);

const fakeDatabase = {
  selectFrom: vi.fn(() => userLookup),
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

function userCookieHeader(username = "alice_1"): string {
  return `openmarket_user=${signUserCookie(username, USER_SECRET)}`;
}

function adminCookieHeader(): string {
  return `openmarket_admin=${signAdminCookie(ADMIN_SECRET)}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
  vi.stubEnv("USER_COOKIE_SECRET", USER_SECRET);
  vi.stubEnv("ADMIN_COOKIE_SECRET", ADMIN_SECRET);
  vi.stubEnv("ADMIN_PASSPHRASE_HASH", "configured-hash");
  mocks.getRuntimeDatabase.mockReturnValue(fakeDatabase);
  mocks.getAdminPassphraseHash.mockReturnValue("configured-hash");
  mocks.verifyAdminPassphrase.mockResolvedValue(true);
  mocks.consumeRateLimit.mockResolvedValue(undefined);
  mocks.consumeNetworkRateLimit.mockResolvedValue(undefined);
  mocks.assertNetworkRateLimitAvailable.mockResolvedValue(undefined);
  userLookup.select.mockReturnValue(userLookup);
  userLookup.where.mockReturnValue(userLookup);
  userLookup.executeTakeFirst.mockResolvedValue({ id: "user-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Part 4 mutation request boundary", () => {
  const routes: readonly [string, PostRoute][] = [
    ["/api/user", userRoute],
    ["/api/quote", quoteRoute],
    ["/api/trade", tradeRoute],
    ["/api/admin/login", adminLoginRoute],
    ["/api/admin/seed", adminSeedRoute],
    ["/api/admin/settle", adminSettleRoute],
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
          slug: "anthropic",
          action: "buy",
          side: "yes",
          strike_index: 3,
          quantity: 2,
          max_cost_usd: "2.00",
          idempotency_key: "1c97cdcb-980b-48b4-9622-0d296c6a98a8",
          user_id: "attacker",
        },
        { cookie: userCookieHeader() },
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

describe("Part 4 user and quote routes", () => {
  it("atomically creates or resumes a user and sets the signed 30-day cookie", async () => {
    mocks.createOrResumeUser.mockResolvedValue({
      id: "user-1",
      username: "Alice_1",
      username_normalized: "alice_1",
      cash_balance_cents: "10000000",
      created_at: new Date("2026-08-31T00:00:00.000Z"),
    });

    const response = await userRoute(mutationRequest("/api/user", { username: "Alice_1" }));

    expect(response.status).toBe(200);

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("openmarket_user=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=2592000");
    expect(setCookie).toContain("Secure");
    const signedValue = setCookie?.match(/openmarket_user=([^;]+)/)?.[1];
    expect(signedValue).toBeTruthy();
    expect(verifyUserCookie(signedValue ?? "", USER_SECRET)).toMatchObject({
      username: "alice_1",
    });
  });

  it("allows anonymous buy quotes", async () => {
    const quote = { market_id: "market-1", action: "buy", quantity: 2 };
    mocks.quoteMarket.mockResolvedValue(quote);
    const input = {
      slug: "anthropic",
      action: "buy",
      side: "yes",
      strike_index: 3,
      quantity: 2,
    } as const;

    const response = await quoteRoute(mutationRequest("/api/quote", input));

    expect(response.status).toBe(200);
    expect(mocks.quoteMarket).toHaveBeenCalledWith(fakeDatabase, input, undefined);
    await expect(response.json()).resolves.toEqual(quote);
  });

  it("requires a signed identity for sells and uses only its database user id", async () => {
    const input = {
      slug: "anthropic",
      action: "sell",
      side: "no",
      strike_index: 3,
      quantity: 1,
    } as const;
    mocks.quoteMarket.mockResolvedValue({ action: "sell", quantity: 1 });

    const missingResponse = await quoteRoute(mutationRequest("/api/quote", input));
    const authenticatedResponse = await quoteRoute(
      mutationRequest("/api/quote", input, {
        cookie: userCookieHeader("Alice_1"),
        "x-user-id": "attacker",
      }),
    );

    expect(missingResponse.status).toBe(401);
    expect(authenticatedResponse.status).toBe(200);
    expect(userLookup.where).toHaveBeenCalledWith("username_normalized", "=", "alice_1");
    expect(mocks.quoteMarket).toHaveBeenCalledTimes(1);
    expect(mocks.quoteMarket).toHaveBeenCalledWith(fakeDatabase, input, "user-1");
    await expect(missingResponse.json()).resolves.toMatchObject({
      error: { code: "USER_REQUIRED" },
    });
  });
});

describe("Part 4 trade route", () => {
  const tradeInput = {
    slug: "anthropic",
    action: "buy",
    side: "yes",
    strike_index: 3,
    quantity: 2,
    max_cost_usd: "2.00",
    idempotency_key: "1c97cdcb-980b-48b4-9622-0d296c6a98a8",
  } as const;

  it("requires the signed user and marks stored idempotent replays", async () => {
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
        cookie: userCookieHeader(),
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
        { ...tradeInput, slug: "a".repeat(5_000) },
        { cookie: userCookieHeader() },
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
        cookie: userCookieHeader(),
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

describe("Part 4 admin mutation routes", () => {
  it("verifies the passphrase and sets a signed 15-minute admin cookie", async () => {
    const response = await adminLoginRoute(
      mutationRequest("/api/admin/login", { passphrase: "correct horse" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.verifyAdminPassphrase).toHaveBeenCalledWith("correct horse", "configured-hash");
    await expect(response.json()).resolves.toEqual({ authenticated: true });
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("openmarket_admin=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=900");
    expect(setCookie).toContain("Secure");
  });

  it("rate-limits admin login before any passphrase verification work", async () => {
    mocks.assertNetworkRateLimitAvailable.mockRejectedValue(
      new ServiceError("RATE_LIMITED", "Too many requests.", { retryAfterSeconds: 42 }),
    );

    const response = await adminLoginRoute(
      mutationRequest("/api/admin/login", { passphrase: "correct horse" }),
    );

    expect(response.status).toBe(429);
    expect(mocks.assertNetworkRateLimitAvailable).toHaveBeenCalledWith(
      fakeDatabase,
      "admin_login",
      expect.any(Request),
    );
    expect(mocks.verifyAdminPassphrase).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
  });

  it("maps an incorrect admin passphrase to ADMIN_REQUIRED without a cookie", async () => {
    mocks.verifyAdminPassphrase.mockResolvedValue(false);

    const response = await adminLoginRoute(
      mutationRequest("/api/admin/login", { passphrase: "incorrect" }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.consumeNetworkRateLimit).toHaveBeenCalledWith(
      fakeDatabase,
      "admin_login",
      expect.any(Request),
    );
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ADMIN_REQUIRED" },
    });
  });

  it("requires admin authentication and strictly seeds through the shared service", async () => {
    const input = {
      name: "Anthropic",
      slug: "anthropic",
      logo_path: "/logos/anthropic.svg",
      b: 100,
      metric_kind: "valuation_median",
      anchor_valuation_usd: "61500000000.00",
      anchor_date: "2026-08-31",
      anchor_description: "Draft operational input",
      sigma: 0.5,
    } as const;
    mocks.seedMarket.mockResolvedValue({
      outcome: "created",
      company: {
        id: "company-1",
        name: "Anthropic",
        slug: "anthropic",
        logo_path: "/logos/anthropic.svg",
        created_at: new Date("2026-08-31T00:00:00.000Z"),
      },
      market: {
        id: "market-1",
        status: "open",
        metric_kind: "valuation_median",
        current_metric: 61_500_000_000,
        created_at: new Date("2026-08-31T00:00:00.000Z"),
      },
    });

    const missingResponse = await adminSeedRoute(mutationRequest("/api/admin/seed", input));
    const authenticatedResponse = await adminSeedRoute(
      mutationRequest("/api/admin/seed", input, {
        cookie: adminCookieHeader(),
      }),
    );

    expect(missingResponse.status).toBe(401);
    expect(authenticatedResponse.status).toBe(200);
    expect(mocks.seedMarket).toHaveBeenCalledTimes(1);
    expect(mocks.seedMarket).toHaveBeenCalledWith(fakeDatabase, input);
    await expect(authenticatedResponse.json()).resolves.toEqual({
      outcome: "created",
      market_id: "market-1",
      slug: "anthropic",
      status: "open",
      metric_kind: "valuation_median",
      current_metric: 61_500_000_000,
      created_at: "2026-08-31T00:00:00.000Z",
    });
  });

  it("requires an exact confirmation slug before irreversible settlement", async () => {
    const input = {
      slug: "anthropic",
      confirm_slug: "anthropic",
      settled_value_usd: "72500000000.00",
      source_url: "https://example.test/valuation",
      source_description: "Reported valuation",
    } as const;
    const result = {
      market_id: "market-1",
      slug: "anthropic",
      settled_value_usd: "72500000000.00",
      winning_bucket: 32,
      credited_users: 2,
      total_payout_cents: "12500",
      rounding_reserve_delta_cents: "0",
      settled_at: "2026-08-31T00:00:00.000Z",
    };
    mocks.settleMarket.mockResolvedValue(result);

    const mismatchResponse = await adminSettleRoute(
      mutationRequest(
        "/api/admin/settle",
        { ...input, confirm_slug: "stripe" },
        { cookie: adminCookieHeader() },
      ),
    );
    const successResponse = await adminSettleRoute(
      mutationRequest("/api/admin/settle", input, {
        cookie: adminCookieHeader(),
      }),
    );

    expect(mismatchResponse.status).toBe(400);
    expect(successResponse.status).toBe(200);
    expect(mocks.settleMarket).toHaveBeenCalledTimes(1);
    expect(mocks.settleMarket).toHaveBeenCalledWith(fakeDatabase, input);
    await expect(successResponse.json()).resolves.toEqual(result);
  });
});
