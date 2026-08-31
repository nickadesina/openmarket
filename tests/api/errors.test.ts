import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  ServiceError,
  isServiceError,
} from "../../src/lib/api/errors.js";

describe("typed service errors", () => {
  it("exports every stable design error code", () => {
    expect(ERROR_CODES).toEqual([
      "INVALID_INPUT",
      "USER_REQUIRED",
      "MARKET_NOT_FOUND",
      "MARKET_SETTLED",
      "INSUFFICIENT_CASH",
      "INSUFFICIENT_HOLDINGS",
      "PRICE_MOVED",
      "IDEMPOTENCY_CONFLICT",
      "ADMIN_REQUIRED",
    ]);
  });

  it("retains typed details and identifies only service errors", () => {
    const error = new ServiceError("PRICE_MOVED", "Price moved", {
      quoted_cost_cents: 500,
      live_cost_cents: 507,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ServiceError");
    expect(error.code).toBe("PRICE_MOVED");
    expect(error.details).toEqual({
      quoted_cost_cents: 500,
      live_cost_cents: 507,
    });
    expect(isServiceError(error)).toBe(true);
    expect(isServiceError(new Error("ordinary"))).toBe(false);
    expect(isServiceError({ code: "PRICE_MOVED" })).toBe(false);
  });
});
