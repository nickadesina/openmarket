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

// Migrate and verify the ledger before compiling: a schema or replay failure
// must abort the deploy before there is a build artifact to promote. Listing
// names is an operator action (`npm run seed:listings`), never a build step.
if (isDeployTarget) {
  validateDeploymentConfig(process.env, vercelEnvironment as DeploymentTarget);
  run("npm", ["run", "db:migrate"]);
  run("npm", ["run", "verify:replay"]);
} else {
  console.log("Skipping deployment migration outside Vercel production/preview.");
}

run("npm", ["run", "build"]);
