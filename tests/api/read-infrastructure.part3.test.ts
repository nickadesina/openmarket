import { describe, expect, it } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import {
  parseBoundedInteger,
  parseOptionalString,
  parseRequiredEnum,
} from "../../src/lib/api/pagination.js";
import { jsonError, jsonSuccess, REQUEST_ID_HEADER } from "../../src/lib/api/response.js";

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

it("distinguishes a signed-in admin denial while preserving anonymous and cron denials", () => {
  expect(
    jsonError(new ServiceError("ADMIN_REQUIRED", "Admin required.", { authenticated: true }), "r")
      .status,
  ).toBe(403);
  expect(
    jsonError(new ServiceError("ADMIN_REQUIRED", "Admin required.", { authenticated: false }), "r")
      .status,
  ).toBe(401);
  expect(jsonError(new ServiceError("ADMIN_REQUIRED", "Admin required."), "r").status).toBe(401);
});

it("keeps server-only admin authentication context out of the public response", async () => {
  const response = jsonError(
    new ServiceError("ADMIN_REQUIRED", "Admin required.", { authenticated: true }),
    "r",
  );
  await expect(response.json()).resolves.toEqual({
    error: { code: "ADMIN_REQUIRED", message: "Admin required.", details: {} },
  });
});
