import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getCronHealth } from "../../src/lib/services/dealer/get-cron-health.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);

import { GET as dealer } from "../../src/app/api/cron/dealer/route.js";
import { GET as settle } from "../../src/app/api/cron/settle/route.js";
import { GET as provenance } from "../../src/app/api/t/cron/provenance/route.js";

const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const SECRET = "cron-scheduling-test-secret";
const NOW = new Date("2026-10-23T12:00:00Z");
const HOUR = 3_600_000;

postgresDescribe(
  databaseUrl === undefined ? `Cron scheduling (${TEST_DATABASE_SKIP_REASON})` : "Cron scheduling",
  () => {
    let postgres: PostgresTestDatabase;
    beforeAll(async () => {
      postgres = await createPostgresTestDatabase(databaseUrl!);
      runtime.getRuntimeDatabase.mockImplementation(() => postgres.db);
    }, 30_000);
    beforeEach(async () => {
      await resetPostgresTestDatabase(postgres.db);
      vi.stubEnv("CRON_SECRET", SECRET);
      vi.stubEnv("SOLANA_PROVENANCE_SECRET_KEY", "");
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    });
    afterAll(async () => {
      if (postgres !== undefined) await postgres.dispose();
    });

    it.each([
      ["dealer", dealer],
      ["settle", settle],
      ["provenance", provenance],
    ] as const)("claims duplicate Vercel %s invocations only once", async (job, route) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const request = () =>
        new Request(`https://t.test/api/cron/${job}`, {
          headers: { authorization: `Bearer ${SECRET}`, "user-agent": "vercel-cron/1.0" },
        });
      const responses = await Promise.all([route(request()), route(request())]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const bodies = await Promise.all(responses.map((response) => response.json()));
      expect(bodies.filter((body) => body.status === "already_ran")).toHaveLength(1);
      const runs = await postgres.db.selectFrom("cron_runs").selectAll().execute();
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ job, status: "succeeded" });
      expect(runs[0]!.run_id).toMatch(new RegExp(`^vercel:${job}:`));
      if (job === "provenance") {
        // No forecasts, hence no batch: a completed invocation still has a heartbeat.
        expect(
          await postgres.db.selectFrom("tournament_provenance_batches").select("id").execute(),
        ).toEqual([]);
      }
    });

    it("does not trust the Vercel user agent without the bearer secret", async () => {
      for (const route of [dealer, settle, provenance]) {
        const response = await route(
          new Request("https://t.test/api/cron", {
            headers: { "user-agent": "vercel-cron/1.0" },
          }),
        );
        expect(response.status).toBe(401);
      }
      expect(await postgres.db.selectFrom("cron_runs").select("id").execute()).toEqual([]);
    });

    it("reports missing jobs as stale", async () => {
      expect(await getCronHealth(postgres.db, NOW)).toEqual([
        { job: "dealer", last_succeeded_at: null, max_age_hours: 1, stale: true },
        { job: "settle", last_succeeded_at: null, max_age_hours: 3, stale: true },
        { job: "provenance", last_succeeded_at: null, max_age_hours: 3, stale: true },
      ]);
    });

    it("uses successful completion times and the strict 1 h / 3 h boundaries", async () => {
      for (const [job, hours] of [
        ["dealer", 1],
        ["settle", 3],
        ["provenance", 3],
      ] as const) {
        const finished = new Date(NOW.getTime() - hours * HOUR);
        await postgres.db
          .insertInto("cron_runs")
          .values({
            job,
            run_id: `vercel:${job}:old`,
            status: "succeeded",
            started_at: new Date(finished.getTime() - 1_000),
            finished_at: finished,
          })
          .execute();
        await postgres.db
          .insertInto("cron_runs")
          .values({
            job,
            run_id: `${job}:failed`,
            status: "failed",
            started_at: NOW,
            finished_at: NOW,
          })
          .execute();
      }
      await postgres.db
        .insertInto("cron_runs")
        .values({
          job: "dealer",
          run_id: "alerts-newest",
          status: "succeeded",
          started_at: NOW,
          finished_at: NOW,
        })
        .execute();
      expect((await getCronHealth(postgres.db, NOW)).every((job) => !job.stale)).toBe(true);
      const stale = await getCronHealth(postgres.db, new Date(NOW.getTime() + 1));
      expect(stale.every((job) => job.stale)).toBe(true);
      expect(stale[0]!.last_succeeded_at).toEqual(new Date(NOW.getTime() - HOUR));
    });
  },
);
