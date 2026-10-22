import { spawnSync } from "node:child_process";

import { type DeploymentTarget, validateDeploymentConfig } from "./verify-production-config.js";

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${String(result.status)}`);
  }
}

const vercelEnvironment = process.env.VERCEL_ENV;
const isDeployTarget = vercelEnvironment === "production" || vercelEnvironment === "preview";

// Migrate, open the launch questions, seed the demo accounts, and verify the
// ledger before compiling: a schema, seed or replay failure must abort the
// deploy before there is a build artifact to promote. The tournament seed only
// creates and opens launch questions that are missing, so a merge that
// replaces them (0004) needs no manual step. The demo seed (decision 0005)
// trades only once, through the real services, and skips cleanly before the
// dealer has quoted, so replay verifies its trades. Listing names is an
// operator action (`npm run seed:listings`), never a build step.
if (isDeployTarget) {
  validateDeploymentConfig(process.env, vercelEnvironment as DeploymentTarget);
  run("npm", ["run", "db:migrate"]);
  run("npm", ["run", "seed:tournament", "--", "--open"]);
  run("npm", ["run", "seed:demo"]);
  run("npm", ["run", "verify:replay"]);
} else {
  console.log("Skipping deployment migration outside Vercel production/preview.");
}

run("npm", ["run", "build"]);
