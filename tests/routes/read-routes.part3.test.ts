import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import { signUserCookie } from "../../src/lib/auth/user-cookie.js";
import type { Database } from "../../src/lib/db/schema.js";

const mocks = vi.hoisted(() => ({
  getRuntimeDatabase: vi.fn(),
  listMarkets: vi.fn(),
  getMarket: vi.fn(),
  getMarks: vi.fn(),
  getActivity: vi.fn(),
  getPortfolio: vi.fn(),
  logReadRequest: vi.fn(),
  logUnexpectedError: vi.fn(),
}));

vi.mock("../../src/lib/db/runtime.js", () => ({
  getRuntimeDatabase: mocks.getRuntimeDatabase,
}));
vi.mock("../../src/lib/logging/server-log.js", () => ({
  logReadRequest: mocks.logReadRequest,
  logUnexpectedError: mocks.logUnexpectedError,
}));
vi.mock("../../src/lib/services/list-markets.js", () => ({
  listMarkets: mocks.listMarkets,
}));
vi.mock("../../src/lib/services/get-market.js", () => ({
  getMarket: mocks.getMarket,
}));
vi.mock("../../src/lib/services/get-marks.js", () => ({
  getMarks: mocks.getMarks,
}));
vi.mock("../../src/lib/services/get-activity.js", () => ({
  ACTIVITY_DEFAULT_LIMIT: 25,
  ACTIVITY_MAX_LIMIT: 100,
  getActivity: mocks.getActivity,
}));
vi.mock("../../src/lib/services/portfolio.js", () => ({
  PORTFOLIO_DEFAULT_TRADE_LIMIT: 25,
  PORTFOLIO_MAX_TRADE_LIMIT: 100,
  getPortfolio: mocks.getPortfolio,
}));

import { GET as getActivityRoute } from "../../src/app/api/activity/route.js";
import { GET as getMarksRoute } from "../../src/app/api/markets/[slug]/marks/route.js";
import { GET as getMarketRoute } from "../../src/app/api/markets/[slug]/route.js";
import { GET as getMarketsRoute } from "../../src/app/api/markets/route.js";
import { GET as getPortfolioRoute } from "../../src/app/api/portfolio/route.js";

const fakeDatabase = {} as Kysely<Database>;
const originalUserCookieSecret = process.env.USER_COOKIE_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRuntimeDatabase.mockReturnValue(fakeDatabase);
});

afterEach(() => {
  if (originalUserCookieSecret === undefined) {
    delete process.env.USER_COOKIE_SECRET;
  } else {
    process.env.USER_COOKIE_SECRET = originalUserCookieSecret;
  }
});

describe("Part 3 public read routes", () => {
  it("does not instantiate the database on import or for an invalid query", async () => {
    expect(mocks.getRuntimeDatabase).not.toHaveBeenCalled();

    const response = await getMarketsRoute(
      new Request("http://localhost/api/markets?unexpected=1"),
    );

    expect(response.status).toBe(400);
    expect(mocks.getRuntimeDatabase).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("returns typed market data with the required response headers", async () => {
    const result = { markets: [], asOf: "2026-01-01T00:00:00.000Z" };
    mocks.listMarkets.mockResolvedValue(result);

    const response = await getMarketsRoute(new Request("http://localhost/api/markets"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    await expect(response.json()).resolves.toEqual(result);
    expect(mocks.listMarkets).toHaveBeenCalledWith(fakeDatabase);
  });

  it("maps a missing market without exposing implementation details", async () => {
    mocks.getMarket.mockRejectedValue(new ServiceError("MARKET_NOT_FOUND", "Market not found."));

    const response = await getMarketRoute(new Request("http://localhost/api/markets/missing"), {
      params: Promise.resolve({ slug: "missing" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MARKET_NOT_FOUND",
        message: "Market not found.",
        details: {},
      },
    });
  });

  it("rejects missing, invalid, and duplicate mark ranges before database access", async () => {
    for (const query of ["", "?range=month", "?range=1h&range=1d"]) {
      const response = await getMarksRoute(
        new Request(`http://localhost/api/markets/acme/marks${query}`),
        { params: Promise.resolve({ slug: "acme" }) },
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INVALID_INPUT" },
      });
    }

    expect(mocks.getMarks).not.toHaveBeenCalled();
    expect(mocks.getRuntimeDatabase).not.toHaveBeenCalled();
  });

  it("passes only a validated bounded activity query to the read model", async () => {
    mocks.getActivity.mockResolvedValue({ items: [], nextCursor: null });

    const response = await getActivityRoute(
      new Request("http://localhost/api/activity?slug=acme&limit=100"),
    );

    expect(response.status).toBe(200);
    expect(mocks.getActivity).toHaveBeenCalledWith(fakeDatabase, {
      slug: "acme",
      limit: 100,
    });
    expect(mocks.logReadRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        pathname: "/api/activity",
        status: 200,
        durationMs: expect.any(Number),
      }),
    );
    expect(JSON.stringify(mocks.logReadRequest.mock.calls[0])).not.toContain("slug=acme");
  });

  it("returns INVALID_INPUT for a malformed activity cursor", async () => {
    mocks.getActivity.mockRejectedValue(
      new ServiceError("INVALID_INPUT", "Malformed activity cursor."),
    );

    const response = await getActivityRoute(
      new Request("http://localhost/api/activity?cursor=not-a-cursor"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("does not expose unexpected database errors", async () => {
    mocks.getActivity.mockRejectedValue(
      new Error("DATABASE_URL=postgres://secret@example.invalid/openmarket"),
    );

    const response = await getActivityRoute(new Request("http://localhost/api/activity"));

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("postgres://");
    expect(JSON.parse(body)).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        details: {},
      },
    });
    expect(mocks.logUnexpectedError).toHaveBeenCalledWith(
      response.headers.get("x-request-id"),
      expect.any(Error),
    );
  });
});

describe("Part 3 portfolio route identity", () => {
  it("requires the signed portfolio cookie and ignores client identity channels", async () => {
    const response = await getPortfolioRoute(
      new Request("http://localhost/api/portfolio?user_id=attacker&offset=0&limit=25", {
        headers: { "x-user-id": "attacker" },
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.getRuntimeDatabase).not.toHaveBeenCalled();
    expect(mocks.getPortfolio).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("returns USER_REQUIRED for missing authentication without opening the pool", async () => {
    const response = await getPortfolioRoute(
      new Request("http://localhost/api/portfolio?offset=0&limit=25"),
    );

    expect(response.status).toBe(401);
    expect(mocks.getRuntimeDatabase).not.toHaveBeenCalled();
    expect(mocks.getPortfolio).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "USER_REQUIRED" },
    });
  });

  it("derives portfolio identity only from the verified cookie", async () => {
    const secret = Buffer.from(Array.from({ length: 32 }, (_unused, index) => index + 33)).toString(
      "base64url",
    );
    process.env.USER_COOKIE_SECRET = secret;
    const cookie = signUserCookie("Alice_1", secret, Date.now());
    const select = vi.fn();
    const where = vi.fn();
    const query = {
      select,
      where,
      executeTakeFirst: vi.fn(async () => ({ id: "user-1" })),
    };
    select.mockReturnValue(query);
    where.mockReturnValue(query);
    const database = {
      selectFrom: vi.fn(() => query),
    } as unknown as Kysely<Database>;
    mocks.getRuntimeDatabase.mockReturnValue(database);
    const portfolio = { userId: "user-1", username: "Alice_1" };
    mocks.getPortfolio.mockResolvedValue(portfolio);

    const response = await getPortfolioRoute(
      new Request("http://localhost/api/portfolio?offset=5&limit=10", {
        headers: {
          cookie: `openmarket_user=${cookie}`,
          "x-user-id": "attacker",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(where).toHaveBeenCalledWith("username_normalized", "=", "alice_1");
    expect(mocks.getPortfolio).toHaveBeenCalledWith(database, "user-1", {
      offset: 5,
      limit: 10,
    });
    await expect(response.json()).resolves.toEqual(portfolio);
  });
});
