import { execFileSync } from "node:child_process";

/** Seeds the test database (tests/browser/seed.ts) before the specs, when there is one. */
export default function globalSetup(): void {
  if (!process.env.DATABASE_URL_TEST?.trim()) return;
  execFileSync("node_modules/.bin/tsx", ["tests/browser/seed.ts"], {
    stdio: "inherit",
    env: process.env,
  });
}
