import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import { TOURNAMENT_SESSION_COOKIE } from "../../src/lib/auth/tournament-session.js";
import type { Database } from "../../src/lib/db/schema.js";

const mocks = vi.hoisted(() => ({
  getRuntimeDatabase: vi.fn(),
  listMarkets: vi.fn(),
  getMarket: vi.fn(),
  getMarks: vi.fn(),
  getActivity: vi.fn(),
  getPortfolio: vi.fn(),
  ensurePaperAccount: vi.fn(),
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
vi.mock("../../src/lib/services/user.js", () => ({
  ensurePaperAccount: mocks.ensurePaperAccount,
}));
vi.mock("../../src/lib/services/portfolio.js", () => ({
  PORTFOLIO_DEFAULT_TRADE_LIMIT: 25,
  PORTFOLIO_MAX_TRADE_LIMIT: 100,
  getPortfolio: mocks.getPortfolio,
}));

import { GET as getActivityRoute } from "../../src/app/api/activity/route.js";
import { GET as getMarketRoute } from "../../src/app/api/markets/[slug]/route.js";
import { GET as getMarksRoute } from "../../src/app/api/markets/by-id/[marketId]/marks/route.js";
import { GET as getMarketsRoute } from "../../src/app/api/markets/route.js";
import { GET as getPortfolioRoute } from "../../src/app/api/portfolio/route.js";

const fakeDatabase = {} as Kysely<Database>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRuntimeDatabase.mockReturnValue(fakeDatabase);
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
    const result = {
      listings: [],
      modelVersion: "1.0.0",
      rulebookVersion: "1.0.0",
      asOf: "2026-01-01T00:00:00.000Z",
    };
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

  it("rejects bad mark ranges and market ids before database access", async () => {
    const marketId = "0f8a0c1e-6c1d-4f7a-9d2b-3c4e5f607182";
    for (const [query, id] of [
      ["", marketId],
      ["?range=month", marketId],
      ["?range=1h&range=1d", marketId],
      ["?range=1d", "acme"],
    ] as const) {
      const response = await getMarksRoute(
        new Request(`http://localhost/api/markets/by-id/${id}/marks${query}`),
        { params: Promise.resolve({ marketId: id }) },
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
  it("rejects client identity channels before any lookup", async () => {
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

  it("derives the portfolio account only from the tournament session", async () => {
    const select = vi.fn();
    const where = vi.fn();
    const query = {
      select,
      where,
      executeTakeFirst: vi.fn(async () => ({
        user_id: "tournament-user-1",
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })),
    };
    select.mockReturnValue(query);
    where.mockReturnValue(query);
    const database = {
      selectFrom: vi.fn(() => query),
    } as unknown as Kysely<Database>;
    mocks.getRuntimeDatabase.mockReturnValue(database);
    mocks.ensurePaperAccount.mockResolvedValue("user-1");
    const portfolio = { userId: "user-1", identity: { handle: "alice", provider: "x" } };
    mocks.getPortfolio.mockResolvedValue(portfolio);

    const response = await getPortfolioRoute(
      new Request("http://localhost/api/portfolio?offset=5&limit=10", {
        headers: {
          cookie: `${TOURNAMENT_SESSION_COOKIE}=${"t".repeat(43)}`,
          "x-user-id": "attacker",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(database.selectFrom).toHaveBeenCalledWith("tournament_sessions");
    expect(mocks.ensurePaperAccount).toHaveBeenCalledWith(database, "tournament-user-1");
    expect(mocks.getPortfolio).toHaveBeenCalledWith(database, "user-1", {
      offset: 5,
      limit: 10,
    });
    await expect(response.json()).resolves.toEqual(portfolio);
  });
});
