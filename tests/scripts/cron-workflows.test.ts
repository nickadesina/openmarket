import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflows = ["dealer", "settle", "provenance", "dealer-alerts"];

function runWithoutSecret(workflow: string, event: string, fork = false) {
  const source = readFileSync(`.github/workflows/${workflow}.yml`, "utf8");
  const body = source.split("        run: |\n")[1];
  if (body === undefined) throw new Error(`No shell step in ${workflow}`);
  return spawnSync("bash", ["-e", "-c", body.replace(/^ {10}/gm, "")], {
    encoding: "utf8",
    env: {
      ...process.env,
      CRON_SECRET: "",
      GITHUB_EVENT_NAME: event,
      REPOSITORY_IS_FORK: String(fork),
    },
  });
}

describe.each(workflows)("%s missing-secret behavior", (workflow) => {
  it("fails a scheduled run", () => {
    const result = runWithoutSecret(workflow, "schedule");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::");
  });

  it.each([
    ["workflow_dispatch", false],
    ["schedule", true],
  ])("warns and skips %s (fork %s)", (event, fork) => {
    const result = runWithoutSecret(workflow, event, fork);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning::");
  });
});
