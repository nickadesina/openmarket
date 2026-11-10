import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CRON_EXECUTION_SECONDS, vercelCronRunId } from "../../src/lib/config/cron.js";
import { resolveRunId } from "../../src/lib/services/dealer/cron-run.js";

describe("Vercel cron slots", () => {
  it.each([
    ["2026-10-23T02:14:59.999Z", "2026-10-23T02:00Z"],
    ["2026-10-23T02:15:00.000Z", "2026-10-23T02:15Z"],
    ["2026-10-23T02:29:59.999Z", "2026-10-23T02:15Z"],
    ["2026-10-23T02:30:00.000Z", "2026-10-23T02:30Z"],
    ["2026-10-23T23:59:59.999Z", "2026-10-23T23:45Z"],
    ["2026-10-24T00:00:00.000Z", "2026-10-24T00:00Z"],
  ])("floors the dealer UTC interval at %s", (time, slot) => {
    expect(vercelCronRunId("dealer", new Date(time))).toBe(`vercel:dealer:${slot}`);
  });

  it.each(["settle", "provenance"] as const)("floors %s to the hour", (job) => {
    expect(vercelCronRunId(job, new Date("2026-10-23T02:59:59.999Z"))).toBe(
      `vercel:${job}:2026-10-23T02Z`,
    );
    expect(vercelCronRunId(job, new Date("2026-10-23T03:00:00Z"))).toBe(
      `vercel:${job}:2026-10-23T03Z`,
    );
  });

  it("deduplicates deliveries in a slot and distinguishes successive scheduled firings", () => {
    const id = (time: string) => resolveRunId(null, "dealer", "vercel-cron/1.0", new Date(time));
    expect(id("2026-10-23T02:20:00Z")).toBe(id("2026-10-23T02:24:00Z"));
    expect(id("2026-10-23T02:20:00Z")).not.toBe(id("2026-10-23T02:35:00Z"));
  });

  it("preserves manual keys and only derives slot keys for Vercel user agents", () => {
    expect(resolveRunId(" alerts-123-2 ", "dealer", "vercel-cron/1.0")).toBe("alerts-123-2");
    expect(resolveRunId(null, "dealer", "curl/vercel-cron/1.0")).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRunId(null, "dealer", null)).not.toBe(resolveRunId(null, "dealer", null));
    expect(() => resolveRunId("bad id", "dealer", "vercel-cron/1.0")).toThrow();
  });
});

it("keeps statically extractable route durations within the reaper budget", () => {
  for (const path of ["cron/dealer", "cron/settle", "t/cron/provenance"]) {
    const source = readFileSync(`src/app/api/${path}/route.ts`, "utf8");
    const literal = source.match(/export const maxDuration = (\d+);/);
    expect(literal).not.toBeNull();
    expect(Number(literal![1])).toBe(CRON_EXECUTION_SECONDS);
    expect(Number(literal![1])).toBeLessThanOrEqual(300);
  }
});

it("schedules no job in the archive and retains build commands", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  expect(config).toMatchObject({
    framework: "nextjs",
    installCommand: "npm ci",
    buildCommand: "npm exec -- tsx --env-file-if-exists=.env.local scripts/vercel-build.ts",
  });
  expect(config.crons).toBeUndefined();
});
