import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("CI", "");
  vi.stubEnv("npm_lifecycle_event", "test:browser:local");
});
afterEach(() => vi.unstubAllEnvs());

it("keeps an explicit local test URL for the browser server", async () => {
  const url = "postgresql://local:local_secret@localhost:5433/chosen_test_db";
  vi.stubEnv("DATABASE_URL_TEST", url);
  const { default: config } = await import("../../playwright.config.js");
  expect(config.webServer).toMatchObject({
    env: { DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
  });
});

it("defaults to the local role only when no test URL was supplied", async () => {
  vi.stubEnv("USER", "local role");
  vi.stubEnv("DATABASE_URL_TEST", "");
  const { default: config } = await import("../../playwright.config.js");
  expect(config.webServer).toMatchObject({
    env: { DATABASE_URL: "postgresql://local%20role@localhost:5432/openmarket_test" },
  });
});
