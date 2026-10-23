import { afterEach, describe, expect, it, vi } from "vitest";

import { isServiceError } from "../../src/lib/api/errors.js";
import { requireCronSecret } from "../../src/lib/auth/cron.js";
import { resolveRunId } from "../../src/lib/services/dealer/cron-run.js";

const SECRET = "a-long-enough-cron-secret";

function request(authorization?: string): Request {
  return new Request("https://t.test/api/cron/dealer", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

function refusal(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return isServiceError(error) ? error.code : "not a service error";
  }
}

describe("cron secret", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses every caller when no secret, or a short one, is configured", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(refusal(() => requireCronSecret(request("Bearer "), "dealer"))).toBe(
      "CRON_UNAUTHORIZED",
    );
    vi.stubEnv("CRON_SECRET", "fifteen-chars!!");
    expect(refusal(() => requireCronSecret(request("Bearer fifteen-chars!!"), "dealer"))).toBe(
      "CRON_UNAUTHORIZED",
    );
  });

  it("accepts only the bearer secret", () => {
    vi.stubEnv("CRON_SECRET", ` ${SECRET} `);
    expect(refusal(() => requireCronSecret(request(), "dealer"))).toBe("CRON_UNAUTHORIZED");
    expect(refusal(() => requireCronSecret(request(SECRET), "dealer"))).toBe("CRON_UNAUTHORIZED");
    expect(refusal(() => requireCronSecret(request(`Bearer ${SECRET}x`), "dealer"))).toBe(
      "CRON_UNAUTHORIZED",
    );
    expect(refusal(() => requireCronSecret(request(`Bearer ${SECRET}`), "dealer"))).toBeNull();
  });
});

describe("cron run id", () => {
  it("keeps a supplied id and generates one when none is sent", () => {
    expect(resolveRunId(" 18234567890-2 ")).toBe("18234567890-2");
    expect(resolveRunId(null)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRunId("")).not.toBe(resolveRunId(""));
  });

  it("refuses an id outside the safe alphabet or over 128 characters", () => {
    expect(refusal(() => resolveRunId("run id"))).toBe("INVALID_INPUT");
    expect(refusal(() => resolveRunId("x".repeat(129)))).toBe("INVALID_INPUT");
  });
});
