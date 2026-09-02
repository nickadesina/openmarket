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

if (isDeployTarget) {
  validateDeploymentConfig(process.env, vercelEnvironment as DeploymentTarget);
} else {
  console.log("Skipping deployment migration outside Vercel production/preview.");
}

run("npm", ["run", "build"]);

// Seeding is an explicit operator action (`npm run seed:production`), never a
// build step: a traded market cannot be reseeded, so an unconditional seed
// would start failing builds once source metadata ages past its freshness window.
if (isDeployTarget) {
  run("npm", ["run", "db:migrate"]);
  if (vercelEnvironment === "production") {
    run("npm", ["run", "verify:replay"]);
  }
}
