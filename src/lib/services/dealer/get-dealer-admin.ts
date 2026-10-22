import type { Kysely } from "kysely";

import type {
  CronRunStatus,
  Database,
  InstrumentKind,
  InstrumentState,
  JsonValue,
  MarketStatus,
} from "../../db/schema.js";
import type { CronJob } from "./cron-run.js";
import { LIVE_STATES } from "./dealer-books.js";
import { type DealerHealth, getDealerHealth } from "./get-dealer-health.js";
import type { PendingPromotion } from "./settle-instruments.js";

/**
 * GET /api/admin/dealer, read by /admin/dealer (TECHNICAL_DESIGN.md §11):
 * the dealer's P&L per listing and epoch from `dealer_pnl`, the live
 * instruments and their widening, the recent runs of each scheduled job,
 * the resolution queue (rank 3–4 promotions the last settle run left
 * pending; read-only until the admin queue is built) and `source_health`
 * as ingest writes it. Every figure is computed here; the page formats.
 */

const JOBS: readonly CronJob[] = ["ingest", "dealer", "settle"];
const RUNS_PER_JOB = 10;

export interface AdminPnlRow {
  readonly instrument_id: string;
  readonly kind: InstrumentKind;
  readonly epoch: number;
  readonly state: InstrumentState;
  readonly market_status: MarketStatus;
  /** Integer cents, from the dealer's side. */
  readonly realised_cents: string;
  readonly open_collateral_cents: string;
  readonly unrealised_cents: string;
  readonly bound_cents: string;
}

export interface AdminPnlListing {
  readonly listing_id: string;
  readonly company: string;
  readonly totals: {
    readonly realised_cents: string;
    readonly unrealised_cents: string;
    readonly open_collateral_cents: string;
    /** The bound carried by the live instruments: what the dealer can still lose. */
    readonly live_bound_cents: string;
  };
  readonly rows: readonly AdminPnlRow[];
}

export interface AdminInstrument {
  readonly id: string;
  readonly company: string;
  readonly slug: string;
  readonly kind: InstrumentKind;
  readonly epoch: number;
  readonly state: InstrumentState;
  readonly opens_at: Date;
  readonly expires_at: Date;
  readonly widened_until: Date | null;
}

export interface AdminCronRun {
  readonly run_id: string;
  readonly status: CronRunStatus;
  readonly started_at: Date;
  readonly finished_at: Date | null;
  readonly duration_ms: number | null;
  readonly error: string | null;
}

export interface AdminPendingPromotion extends PendingPromotion {
  readonly source_url: string | null;
  readonly observed_at: Date | null;
  readonly published_at: Date | null;
  /** True once a later settle run promoted it (or an admin printed it). */
  readonly promoted_since: boolean;
}

export interface AdminSource {
  readonly source: string;
  readonly last_success_at: Date | null;
  readonly last_error_at: Date | null;
  readonly last_error: string | null;
}

export interface DealerAdminPayload {
  readonly as_of: Date;
  readonly pnl: readonly AdminPnlListing[];
  readonly instruments: readonly AdminInstrument[];
  readonly cron_runs: readonly { readonly job: CronJob; readonly runs: readonly AdminCronRun[] }[];
  readonly resolution_queue: {
    /** The settle run the queue is read from, or null before the first succeeded run. */
    readonly run_id: string | null;
    readonly finished_at: Date | null;
    readonly pending: readonly AdminPendingPromotion[];
  };
  readonly sources: readonly AdminSource[];
  readonly health: DealerHealth;
}

function cents(value: number): string {
  return String(Math.round(value));
}

async function pnlByListing(db: Kysely<Database>): Promise<AdminPnlListing[]> {
  const rows = await db
    .selectFrom("dealer_pnl")
    .selectAll()
    .orderBy("company")
    .orderBy("kind")
    .orderBy("epoch", "desc")
    .execute();
  const listings = new Map<string, { company: string; rows: AdminPnlRow[]; live: number[] }>();
  for (const row of rows) {
    const listing = listings.get(row.listing_id) ?? { company: row.company, rows: [], live: [] };
    listing.rows.push({
      instrument_id: row.instrument_id,
      kind: row.kind,
      epoch: row.epoch,
      state: row.state,
      market_status: row.market_status,
      realised_cents: row.realised_cents,
      open_collateral_cents: row.open_collateral_cents,
      unrealised_cents: cents(row.unrealised_cents),
      bound_cents: cents(row.bound_cents),
    });
    if (LIVE_STATES.includes(row.state)) listing.live.push(row.bound_cents);
    listings.set(row.listing_id, listing);
  }
  return [...listings].map(([listingId, listing]) => {
    const sum = (pick: (row: AdminPnlRow) => string) =>
      listing.rows.reduce((total, row) => total + BigInt(pick(row)), 0n).toString();
    return {
      listing_id: listingId,
      company: listing.company,
      totals: {
        realised_cents: sum((row) => row.realised_cents),
        unrealised_cents: sum((row) => row.unrealised_cents),
        open_collateral_cents: sum((row) => row.open_collateral_cents),
        live_bound_cents: cents(listing.live.reduce((total, bound) => total + bound, 0)),
      },
      rows: listing.rows,
    };
  });
}

function errorOf(detail: JsonValue | null): string | null {
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return null;
  return typeof detail.error === "string" ? detail.error : null;
}

async function recentRuns(db: Kysely<Database>, job: CronJob): Promise<AdminCronRun[]> {
  const rows = await db
    .selectFrom("cron_runs")
    .select(["run_id", "status", "started_at", "finished_at", "detail_json"])
    .where("job", "=", job)
    .orderBy("started_at", "desc")
    .orderBy("run_id", "desc")
    .limit(RUNS_PER_JOB)
    .execute();
  return rows.map((row) => ({
    run_id: row.run_id,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    duration_ms:
      row.finished_at === null ? null : row.finished_at.getTime() - row.started_at.getTime(),
    error: row.status === "failed" ? errorOf(row.detail_json) : null,
  }));
}

function isPending(value: unknown): value is PendingPromotion {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.flag_id === "string" && typeof record.reason === "string";
}

async function resolutionQueue(
  db: Kysely<Database>,
): Promise<DealerAdminPayload["resolution_queue"]> {
  const run = await db
    .selectFrom("cron_runs")
    .select(["run_id", "finished_at", "detail_json"])
    .where("job", "=", "settle")
    .where("status", "=", "succeeded")
    .orderBy("finished_at", "desc")
    .orderBy("run_id", "desc")
    .executeTakeFirst();
  if (run === undefined) return { run_id: null, finished_at: null, pending: [] };
  const detail = run.detail_json;
  const listed =
    detail !== null && typeof detail === "object" && !Array.isArray(detail)
      ? detail.pending
      : undefined;
  const reported: PendingPromotion[] = Array.isArray(listed)
    ? (listed as unknown[]).filter(isPending)
    : [];
  const ids = reported.map((flag) => flag.flag_id);
  const flags =
    ids.length === 0
      ? []
      : await db
          .selectFrom("event_flags")
          .select(["id", "source_url", "observed_at", "published_at"])
          .select((eb) =>
            eb
              .exists(
                eb
                  .selectFrom("event_flags as print")
                  .select("print.id")
                  .whereRef("print.promoted_from", "=", "event_flags.id"),
              )
              .as("promoted"),
          )
          .where("id", "in", ids)
          .execute();
  const byId = new Map(flags.map((flag) => [flag.id, flag]));
  return {
    run_id: run.run_id,
    finished_at: run.finished_at,
    pending: reported.map((flag) => {
      const row = byId.get(flag.flag_id);
      return {
        ...flag,
        source_url: row?.source_url ?? null,
        observed_at: row?.observed_at ?? null,
        published_at: row?.published_at ?? null,
        promoted_since: row?.promoted === true,
      };
    }),
  };
}

export async function getDealerAdmin(db: Kysely<Database>, now: Date): Promise<DealerAdminPayload> {
  const instruments = await db
    .selectFrom("instruments")
    .innerJoin("listings", "listings.id", "instruments.listing_id")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .select([
      "instruments.id",
      "companies.name as company",
      "companies.slug",
      "instruments.kind",
      "instruments.epoch",
      "instruments.state",
      "instruments.opens_at",
      "instruments.expires_at",
      "instruments.widened_until",
    ])
    .where("instruments.state", "in", LIVE_STATES)
    .orderBy("companies.name")
    .orderBy("instruments.kind")
    .execute();
  const cronRuns = [];
  for (const job of JOBS) cronRuns.push({ job, runs: await recentRuns(db, job) });
  const sources = await db.selectFrom("source_health").selectAll().orderBy("source").execute();
  return {
    as_of: now,
    pnl: await pnlByListing(db),
    instruments,
    cron_runs: cronRuns,
    resolution_queue: await resolutionQueue(db),
    sources,
    health: await getDealerHealth(db, now),
  };
}
