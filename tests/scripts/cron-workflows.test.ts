import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflows = ["dealer-alerts"];

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

function runAlert(report: unknown) {
  const source = readFileSync(".github/workflows/dealer-alerts.yml", "utf8");
  const body = source.split("        run: |\n")[1]!;
  return spawnSync(
    "bash",
    ["-e", "-c", `curl() { printf '%s' "$TEST_REPORT"; }\n${body.replace(/^ {10}/gm, "")}`],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CRON_SECRET: "test-only-alert-secret",
        GITHUB_EVENT_NAME: "schedule",
        REPOSITORY_IS_FORK: "false",
        RUN_ID: "alerts-test-1",
        DEALER_URL: "https://example.test/api/cron/dealer",
        TEST_REPORT: JSON.stringify(report),
      },
    },
  );
}

const healthy = {
  status: "succeeded",
  health: {
    widened_over_hold: { hold_hours: 72, instruments: [] },
    jobs: ["dealer", "settle", "provenance"].map((job) => ({
      job,
      stale: false,
      last_succeeded_at: "2026-10-23T02:00:00Z",
    })),
  },
};

describe("daily alert", () => {
  it("passes a successful run with fresh jobs and no widened instruments", () => {
    expect(runAlert(healthy).status).toBe(0);
  });

  it.each(["dealer", "settle", "provenance"])("fails on stale %s", (job) => {
    const report = structuredClone(healthy);
    report.health.jobs.find((entry) => entry.job === job)!.stale = true;
    expect(runAlert(report).status).toBe(1);
  });

  it("fails closed on missing or incomplete freshness data", () => {
    expect(
      runAlert({
        status: "succeeded",
        health: { widened_over_hold: healthy.health.widened_over_hold },
      }).status,
    ).toBe(1);
    const report = structuredClone(healthy);
    report.health.jobs.pop();
    expect(runAlert(report).status).toBe(1);
  });

  it("still fails when the dealer did not succeed or an instrument exceeded the hold", () => {
    expect(runAlert({ ...healthy, status: "already_ran" }).status).toBe(1);
    expect(
      runAlert({
        ...healthy,
        health: {
          ...healthy.health,
          widened_over_hold: {
            hold_hours: 72,
            instruments: [
              {
                company: "Example",
                kind: "forward",
                widened_since: "2026-10-01",
                hours_widened: 73,
              },
            ],
          },
        },
      }).status,
    ).toBe(1);
  });
});
