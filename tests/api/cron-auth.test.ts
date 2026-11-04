import { afterEach, describe, expect, it, vi } from "vitest";

import { isServiceError } from "../../src/lib/api/errors.js";
import { requireCronSecret } from "../../src/lib/auth/cron.js";

const SECRET = "a-long-enough-cron-secret";

function request(authorization?: string): Request {
  return new Request("https://t.test/api/cron/ingest", {
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
    expect(refusal(() => requireCronSecret(request("Bearer "), "ingest"))).toBe(
      "CRON_UNAUTHORIZED",
    );
    vi.stubEnv("CRON_SECRET", "fifteen-chars!!");
    expect(refusal(() => requireCronSecret(request("Bearer fifteen-chars!!"), "ingest"))).toBe(
      "CRON_UNAUTHORIZED",
    );
  });

  it("accepts only the bearer secret", () => {
    vi.stubEnv("CRON_SECRET", ` ${SECRET} `);
    expect(refusal(() => requireCronSecret(request(), "ingest"))).toBe("CRON_UNAUTHORIZED");
    expect(refusal(() => requireCronSecret(request(SECRET), "ingest"))).toBe("CRON_UNAUTHORIZED");
    expect(refusal(() => requireCronSecret(request(`Bearer ${SECRET}x`), "ingest"))).toBe(
      "CRON_UNAUTHORIZED",
    );
    expect(refusal(() => requireCronSecret(request(`Bearer ${SECRET}`), "ingest"))).toBeNull();
  });
});
