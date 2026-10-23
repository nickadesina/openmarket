import { afterEach, describe, expect, it, vi } from "vitest";

import { validateDeploymentConfig } from "../../scripts/verify-production-config.js";

const production = {
  DATABASE_URL:
    "postgresql://role:longrandomcredential@ep-solid-pine-pooler.neon.tech/db?sslmode=require",
  DATABASE_URL_UNPOOLED:
    "postgresql://role:longrandomcredential@ep-solid-pine.neon.tech/db?sslmode=require",
  APP_ORIGIN: "https://openmarket.systems",
  VERCEL_ENV: "production",
  NEON_BRANCH_ROLE: "production",
  NEON_BRANCH_ID: "br-solid-pine",
  PRODUCTION_NEON_BRANCH_ID: "br-solid-pine",
  PRODUCTION_DATABASE_HOST: "ep-solid-pine.neon.tech",
};
const preview = {
  ...production,
  DATABASE_URL:
    "postgresql://role:longrandomcredential@ep-green-oak-pooler.neon.tech/db?sslmode=require",
  DATABASE_URL_UNPOOLED:
    "postgresql://role:longrandomcredential@ep-green-oak.neon.tech/db?sslmode=require",
  VERCEL_ENV: "preview",
  NEON_BRANCH_ROLE: "preview",
  NEON_BRANCH_ID: "br-green-oak",
};

afterEach(() => vi.restoreAllMocks());

describe("deployment cron secret", () => {
  it.each([undefined, "", "   ", "123456789012345", "  123456789012345  "])(
    "refuses a missing or short production secret without revealing it",
    (CRON_SECRET) => {
      expect(() =>
        validateDeploymentConfig({ ...production, CRON_SECRET }, "production", "22.0.0"),
      ).toThrow("CRON_SECRET must contain at least 16 characters");
    },
  );

  it("accepts the runtime's trimmed minimum length", () => {
    expect(() =>
      validateDeploymentConfig(
        { ...production, CRON_SECRET: "  1234567890123456  " },
        "production",
        "22.0.0",
      ),
    ).not.toThrow();
  });

  it("only warns for a preview without a valid secret", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => validateDeploymentConfig(preview, "preview", "22.0.0")).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CRON_SECRET"));
  });
});
