import { type Kysely, sql } from "kysely";

import type { ScheduledJob } from "../../config/cron.js";
import type { Database } from "../../db/schema.js";

const MAX_AGE_HOURS = { dealer: 1, settle: 3, provenance: 3 } as const;

export interface CronHealth {
  readonly job: ScheduledJob;
  readonly last_succeeded_at: Date | null;
  readonly max_age_hours: number;
  readonly stale: boolean;
}

/** Alert probes must not make a stopped scheduler look healthy, even on the next probe. */
export async function getCronHealth(db: Kysely<Database>, now: Date): Promise<CronHealth[]> {
  const rows = await db
    .selectFrom("cron_runs")
    .select(["job", sql<Date | null>`max(finished_at)`.as("last_succeeded_at")])
    .where("job", "in", ["dealer", "settle", "provenance"])
    .where("status", "=", "succeeded")
    .where("run_id", "not like", "alerts-%")
    .groupBy("job")
    .execute();
  return (Object.keys(MAX_AGE_HOURS) as ScheduledJob[]).map((job) => {
    const last = rows.find((row) => row.job === job)?.last_succeeded_at ?? null;
    const maxAge = MAX_AGE_HOURS[job];
    return {
      job,
      last_succeeded_at: last,
      max_age_hours: maxAge,
      stale: last === null || now.getTime() - last.getTime() > maxAge * 3_600_000,
    };
  });
}
