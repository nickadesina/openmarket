import { spawnSync } from "node:child_process";

import {
  validateDeploymentConfig,
  type DeploymentTarget,
} from "./verify-production-config.js";

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
if (vercelEnvironment === "production" || vercelEnvironment === "preview") {
  validateDeploymentConfig(
    process.env,
    vercelEnvironment as DeploymentTarget,
  );
  run("npm", ["run", "db:migrate"]);
  if (vercelEnvironment === "production") {
    run("npm", ["run", "seed:production"]);
    run("npm", ["run", "verify:replay"]);
  }
} else {
  console.log("Skipping deployment migration outside Vercel production/preview.");
}

run("npm", ["run", "build"]);
