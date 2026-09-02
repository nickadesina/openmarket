import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import {
  parseBoundedInteger,
  parseOptionalString,
  parseRequiredEnum,
} from "../../src/lib/api/pagination.js";
import { jsonError, jsonSuccess, REQUEST_ID_HEADER } from "../../src/lib/api/response.js";
import { requireCurrentUserId } from "../../src/lib/auth/current-user.js";
import { signUserCookie } from "../../src/lib/auth/user-cookie.js";
import type { Database } from "../../src/lib/db/schema.js";

const originalUserCookieSecret = process.env.USER_COOKIE_SECRET;

afterEach(() => {
  if (originalUserCookieSecret === undefined) {
    delete process.env.USER_COOKIE_SECRET;
  } else {
    process.env.USER_COOKIE_SECRET = originalUserCookieSecret;
  }
});

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
  it("does not access the database when the signed cookie is missing", async () => {
    const database = {} as Kysely<Database>;
    const getDatabase = vi.fn(() => database);

    await expect(
      requireCurrentUserId(new Request("http://localhost/api/portfolio"), getDatabase),
    ).rejects.toMatchObject({ code: "USER_REQUIRED" });
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it("verifies only the signed cookie and resolves its normalized username", async () => {
    const secret = Buffer.from(Array.from({ length: 32 }, (_unused, index) => index + 1)).toString(
      "base64url",
    );
    process.env.USER_COOKIE_SECRET = secret;
    const cookie = signUserCookie("Alice_1", secret, Date.now());
    const executeTakeFirst = vi.fn(async () => ({ id: "user-1" }));
    const query = {
      select: vi.fn(),
      where: vi.fn(),
      executeTakeFirst,
    };
    query.select.mockReturnValue(query);
    query.where.mockReturnValue(query);
    const database = {
      selectFrom: vi.fn(() => query),
    } as unknown as Kysely<Database>;

    const userId = await requireCurrentUserId(
      new Request("http://localhost/api/portfolio?user_id=attacker", {
        headers: { cookie: `openmarket_user=${cookie}` },
      }),
      () => database,
    );

    expect(userId).toBe("user-1");
    expect(query.where).toHaveBeenCalledWith("username_normalized", "=", "alice_1");
  });
});
