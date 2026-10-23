import { type Kysely, sql } from "kysely";

import { DEALER_PARAMS } from "../../config/dealer.js";
import type { Database, InstrumentKind } from "../../db/schema.js";

import { type CronHealth, getCronHealth } from "./get-cron-health.js";

const HOUR_MS = 3_600_000;

export interface WidenedInstrument {
  readonly instrument_id: string;
  readonly company: string;
  readonly kind: InstrumentKind;
  /** The first widen of the current streak: the earliest `widen` quote since the last list or restore. */
  readonly widened_since: Date;
  readonly widened_until: Date | null;
  readonly hours_widened: number;
}

export interface DealerHealth {
  /** Successful invocations, including idle provenance hours; excludes alert probes. */
  readonly jobs: readonly CronHealth[];
  readonly instruments_quoting: number;
  readonly instruments_widened: number;
  /** Live instruments with no model mid at all: a step that should have written one did not. */
  readonly instruments_without_mid: number;
  /**
   * Instruments widened continuously for longer than the flag hold
   * (params.json → dealer.flag_hours, 72 h): a re-price or the hold's end
   * should have restored them. `.github/workflows/dealer-alerts.yml` fails on any.
   */
  readonly widened_over_hold: {
    readonly hold_hours: number;
    readonly instruments: readonly WidenedInstrument[];
  };
  readonly latest_flag_observed_at: Date | null;
  /** Ingest's per-source record; empty until ingest writes it. */
  readonly sources: readonly {
    readonly source: string;
    readonly last_success_at: Date | null;
    readonly last_error_at: Date | null;
  }[];
}

/** Widened instruments with the start of their current widened streak. */
async function widenedStreaks(
  db: Kysely<Database>,
  now: Date,
  holdHours: number,
): Promise<WidenedInstrument[]> {
  const rows = await db
    .selectFrom("instruments")
    .innerJoin("listings", "listings.id", "instruments.listing_id")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .select([
      "instruments.id as instrument_id",
      "companies.name as company",
      "instruments.kind",
      "instruments.widened_until",
      sql<Date | null>`(
        select min(widen.posted_at) from quotes widen
        where widen.instrument_id = instruments.id
          and widen.reason = 'widen'
          and widen.posted_at > coalesce((
            select max(change.posted_at) from quotes change
            where change.instrument_id = instruments.id
              and change.reason in ('list', 'restore')
          ), '-infinity'::timestamptz)
      )`.as("first_widen"),
    ])
    .where("instruments.state", "=", "widened")
    .orderBy("companies.name")
    .orderBy("instruments.kind")
    .execute();
  return rows.map((row) => {
    // A forward widened before it had a mid posts no widen quote; its hold says when.
    const since =
      row.first_widen ?? new Date((row.widened_until ?? now).getTime() - holdHours * HOUR_MS);
    return {
      instrument_id: row.instrument_id,
      company: row.company,
      kind: row.kind,
      widened_since: since,
      widened_until: row.widened_until,
      hours_widened: (now.getTime() - since.getTime()) / HOUR_MS,
    };
  });
}

/** What the dealer job reports beside its work, and /admin/dealer reads. */
export async function getDealerHealth(
  db: Kysely<Database>,
  now: Date = new Date(),
  holdHours: number = DEALER_PARAMS.dealer.flag_hours,
): Promise<DealerHealth> {
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
  const widened = await widenedStreaks(db, now, holdHours);
  return {
    jobs: await getCronHealth(db, now),
    instruments_quoting: counts.quoting,
    instruments_widened: counts.widened,
    instruments_without_mid: counts.without_mid,
    widened_over_hold: {
      hold_hours: holdHours,
      instruments: widened.filter((instrument) => instrument.hours_widened > holdHours),
    },
    latest_flag_observed_at: flags.latest,
    sources,
  };
}
