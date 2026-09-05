import { describe, expect, it } from "vitest";

import { isServiceError, ServiceError } from "../../src/lib/api/errors.js";

describe("typed service errors", () => {
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
