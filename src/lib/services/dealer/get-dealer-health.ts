import { type Kysely, sql } from "kysely";

import type { Database } from "../../db/schema.js";

export interface DealerHealth {
  readonly instruments_quoting: number;
  readonly instruments_widened: number;
  /** Live instruments with no model mid at all: a step that should have written one did not. */
  readonly instruments_without_mid: number;
  readonly latest_flag_observed_at: Date | null;
  /** Ingest's per-source record; empty until ingest writes it. */
  readonly sources: readonly {
    readonly source: string;
    readonly last_success_at: Date | null;
    readonly last_error_at: Date | null;
  }[];
}

/** What the dealer job reports beside its work, and /admin/dealer will read. */
export async function getDealerHealth(db: Kysely<Database>): Promise<DealerHealth> {
  const counts = await db
    .selectFrom("instruments")
    .select([
      sql<number>`count(*) filter (where state = 'quoting')::int`.as("quoting"),
      sql<number>`count(*) filter (where state = 'widened')::int`.as("widened"),
      sql<number>`count(*) filter (
        where state in ('quoting', 'widened')
          and not exists (select 1 from model_mids where model_mids.instrument_id = instruments.id)
      )::int`.as("without_mid"),
    ])
    .executeTakeFirstOrThrow();
  const flags = await db
    .selectFrom("event_flags")
    .select(sql<Date | null>`max(observed_at)`.as("latest"))
    .executeTakeFirstOrThrow();
  const sources = await db
    .selectFrom("source_health")
    .select(["source", "last_success_at", "last_error_at"])
    .orderBy("source")
    .execute();
  return {
    instruments_quoting: counts.quoting,
    instruments_widened: counts.widened,
    instruments_without_mid: counts.without_mid,
    latest_flag_observed_at: flags.latest,
    sources,
  };
}
