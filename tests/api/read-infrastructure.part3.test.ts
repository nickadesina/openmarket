import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import {
  parseBoundedInteger,
  parseOptionalString,
  parseRequiredEnum,
} from "../../src/lib/api/pagination.js";
import { jsonError, jsonSuccess, REQUEST_ID_HEADER } from "../../src/lib/api/response.js";
import { requireCurrentUserId } from "../../src/lib/auth/current-user.js";
import { TOURNAMENT_SESSION_COOKIE } from "../../src/lib/auth/tournament-session.js";
import type { Database } from "../../src/lib/db/schema.js";
import { INITIAL_USER_BALANCE_CENTS } from "../../src/lib/services/user.js";

/** A Kysely-shaped builder whose terminal calls resolve to `result`. */
function builder(result: unknown) {
  const query = {
    select: vi.fn(),
    where: vi.fn(),
    values: vi.fn(),
    onConflict: vi.fn(),
    execute: vi.fn(async () => []),
    executeTakeFirst: vi.fn(async () => result),
    executeTakeFirstOrThrow: vi.fn(async () => result),
  };
  for (const method of ["select", "where", "values", "onConflict"] as const) {
    query[method].mockReturnValue(query);
  }
  return query;
}

const SESSION_TOKEN = "a".repeat(43);

describe("Part 3 JSON responses", () => {
  it("serializes JSON-safe boundary values and enforces read response headers", async () => {
    const response = jsonSuccess(
      {
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
        sequence: 9n,
      },
      { requestId: "request-1" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("request-1");
    await expect(response.json()).resolves.toEqual({
      createdAt: "2026-01-02T03:04:05.000Z",
      sequence: "9",
    });
  });

  it("maps ServiceError codes to a stable public envelope", async () => {
    const response = jsonError(
      new ServiceError("MARKET_NOT_FOUND", "Market not found.", {
        slug: "missing",
      }),
      "request-2",
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("request-2");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MARKET_NOT_FOUND",
        message: "Market not found.",
        details: { slug: "missing" },
      },
    });
  });
});

describe("Part 3 exact query parsing", () => {
  it("accepts only canonical bounded unsigned integers", () => {
    expect(
      parseBoundedInteger(new URLSearchParams("limit=25"), "limit", {
        defaultValue: 10,
        minimum: 1,
        maximum: 100,
      }),
    ).toBe(25);

    for (const value of ["", "025", "+2", "2.0", "1e2", " 2", "101"]) {
      expect(() =>
        parseBoundedInteger(new URLSearchParams([["limit", value]]), "limit", {
          defaultValue: 10,
          minimum: 1,
          maximum: 100,
        }),
      ).toThrowError(ServiceError);
    }
  });

  it("rejects duplicate, empty, oversized, and non-enum values", () => {
    expect(() =>
      parseOptionalString(new URLSearchParams("cursor=a&cursor=b"), "cursor", {
        maximumLength: 10,
      }),
    ).toThrowError(ServiceError);
    expect(() =>
      parseOptionalString(new URLSearchParams("cursor="), "cursor", {
        maximumLength: 10,
      }),
    ).toThrowError(ServiceError);
    expect(() =>
      parseRequiredEnum(new URLSearchParams("range=month"), "range", ["1h", "1d"]),
    ).toThrowError(ServiceError);
  });
});

describe("Part 3 current user", () => {
  it("does not access the database without a session cookie", async () => {
    const database = {} as Kysely<Database>;
    const getDatabase = vi.fn(() => database);

    await expect(
      requireCurrentUserId(new Request("http://localhost/api/portfolio"), getDatabase),
    ).rejects.toMatchObject({ code: "USER_REQUIRED" });
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it("refuses a session cookie with no live session", async () => {
    const sessions = builder(undefined);
    const database = { selectFrom: vi.fn(() => sessions) } as unknown as Kysely<Database>;

    await expect(
      requireCurrentUserId(
        new Request("http://localhost/api/portfolio", {
          headers: { cookie: `${TOURNAMENT_SESSION_COOKIE}=${SESSION_TOKEN}` },
        }),
        () => database,
      ),
    ).rejects.toMatchObject({ code: "USER_REQUIRED" });
  });

  it("opens the session's paper account, ignoring client identity channels", async () => {
    const sessions = builder({
      user_id: "tournament-user-1",
      expires_at: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000 + 60_000),
    });
    const insert = builder(undefined);
    const accounts = builder({ id: "user-1" });
    const database = {
      selectFrom: vi.fn((table: string) => (table === "users" ? accounts : sessions)),
      insertInto: vi.fn(() => insert),
    } as unknown as Kysely<Database>;

    const userId = await requireCurrentUserId(
      new Request("http://localhost/api/portfolio?user_id=attacker", {
        headers: { cookie: `${TOURNAMENT_SESSION_COOKIE}=${SESSION_TOKEN}` },
      }),
      () => database,
    );

    expect(userId).toBe("user-1");
    expect(insert.values).toHaveBeenCalledWith({
      tournament_user_id: "tournament-user-1",
      cash_balance_cents: INITIAL_USER_BALANCE_CENTS,
    });
    expect(accounts.where).toHaveBeenCalledWith("tournament_user_id", "=", "tournament-user-1");
  });
});
