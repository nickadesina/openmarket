import { spawnSync } from "node:child_process";

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

// The archived v1 (decision 0003) never migrates or seeds: its database is a
// Neon branch copied from production when v2 replaced it, already carrying
// v2's later migrations, which this tree does not know. The deploy only proves
// the copied ledger still replays before compiling.
if (isDeployTarget) {
  run("npm", ["run", "verify:replay"]);
} else {
  console.log("Skipping the replay check outside Vercel production/preview.");
}

run("npm", ["run", "build"]);
