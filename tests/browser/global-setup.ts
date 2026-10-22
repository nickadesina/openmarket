import { execFileSync } from "node:child_process";

/**
 * Playwright global setup: lists the five names and runs one dealer job
 * against DATABASE_URL_TEST (`seed-dealer.ts`, under tsx so the dealer
 * config's JSON import loads). No production route is involved.
 */
export default function globalSetup(): void {
  if ((process.env.DATABASE_URL_TEST ?? "").trim() === "") return;
  execFileSync("npx", ["tsx", "tests/browser/seed-dealer.ts"], {
    stdio: "inherit",
    env: process.env,
  });
}
