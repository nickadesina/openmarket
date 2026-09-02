import { randomBytes, scryptSync } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

const hasTestDatabase = Boolean(process.env.DATABASE_URL_TEST);
const isCi = Boolean(process.env.CI);

if (isCi && !hasTestDatabase) {
  throw new Error("DATABASE_URL_TEST is required for Playwright in CI.");
}
if (!isCi && !hasTestDatabase) {
  console.warn(
    "Playwright browser tests are skipped locally because DATABASE_URL_TEST is not set.",
  );
}

const appOrigin =
  process.env.PLAYWRIGHT_APP_ORIGIN ??
  (isCi ? (process.env.APP_ORIGIN ?? "http://127.0.0.1:3000") : "http://127.0.0.1:3100");
const origin = new URL(appOrigin);
if (
  origin.protocol !== "http:" ||
  origin.username !== "" ||
  origin.password !== "" ||
  origin.pathname !== "/" ||
  origin.search !== "" ||
  origin.hash !== ""
) {
  throw new Error("PLAYWRIGHT_APP_ORIGIN must be an HTTP origin without a path.");
}
if (origin.port === "") {
  throw new Error("PLAYWRIGHT_APP_ORIGIN must include the local Next.js port.");
}

const adminPassphrase =
  process.env.PLAYWRIGHT_ADMIN_PASSPHRASE ?? "openmarket-browser-test-admin-passphrase-v1";
process.env.PLAYWRIGHT_ADMIN_PASSPHRASE = adminPassphrase;

const adminSalt = randomBytes(16);
const adminKey = scryptSync(adminPassphrase, adminSalt, 64, {
  N: 16_384,
  r: 8,
  p: 1,
});
const adminPassphraseHash = [
  "scrypt",
  "16384",
  "8",
  "1",
  adminSalt.toString("base64url"),
  adminKey.toString("base64url"),
].join("$");

const userCookieSecret = randomBytes(32).toString("base64url");
let adminCookieSecret = randomBytes(32).toString("base64url");
while (adminCookieSecret === userCookieSecret) {
  adminCookieSecret = randomBytes(32).toString("base64url");
}

const port = origin.port;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  reporter: isCi ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: appOrigin,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
  ...(hasTestDatabase
    ? {
        webServer: {
          command: `npm run dev -- -H ${origin.hostname} -p ${port}`,
          url: appOrigin,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            DATABASE_URL: process.env.DATABASE_URL_TEST!,
            DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_TEST!,
            APP_ORIGIN: appOrigin,
            USER_COOKIE_SECRET: userCookieSecret,
            ADMIN_COOKIE_SECRET: adminCookieSecret,
            ADMIN_PASSPHRASE_HASH: adminPassphraseHash,
          },
        },
      }
    : {}),
});
