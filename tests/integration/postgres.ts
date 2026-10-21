import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { type Kysely, sql } from "kysely";
import { Client } from "pg";

import {
  createTournamentSession,
  TOURNAMENT_SESSION_COOKIE,
} from "../../src/lib/auth/tournament-session.js";
import { createPooledDatabase, destroyDatabase } from "../../src/lib/db/client.js";
import { createMigrator } from "../../src/lib/db/migrator.js";
import type { CompanyRow, Database, MarketRow } from "../../src/lib/db/schema.js";
import { seedBinaryMarket } from "../../src/lib/engine/seed.js";
import { upsertIdentity } from "../../src/lib/services/tournament/sign-in.js";
import { ensurePaperAccount } from "../../src/lib/services/user.js";

export const TEST_DATABASE_SKIP_REASON =
  "DATABASE_URL_TEST is not set; PostgreSQL integration tests require a disposable database.";

export interface PostgresTestDatabase {
  readonly db: Kysely<Database>;
  readonly connectionString: string;
  readonly schema: string;
  readonly applicationName: string;
  dispose(): Promise<void>;
}

export interface HeldAdvisoryLock {
  waitForWaiter(timeoutMs?: number): Promise<void>;
  release(): Promise<void>;
}

export function testDatabaseUrl(): string | undefined {
  const value = process.env.DATABASE_URL_TEST?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function schemaIdentifier(): string {
  return `openmarket_test_${randomUUID().replaceAll("-", "")}`;
}

function scopedConnectionString(
  connectionString: string,
  schema: string,
  applicationName: string,
): string {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL_TEST must be a PostgreSQL URL");
  }
  url.searchParams.set("options", `-c search_path=${schema},public`);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

async function executeAdminStatement(connectionString: string, statement: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function dropSchema(connectionString: string, schema: string): Promise<void> {
  await executeAdminStatement(connectionString, `drop schema if exists "${schema}" cascade`);
}

/** A fresh schema migrated to latest, or to `migrateTo` to test a later migration on old data. */
export async function createPostgresTestDatabase(
  connectionString: string,
  migrateTo?: string,
): Promise<PostgresTestDatabase> {
  const schema = schemaIdentifier();
  const applicationName = schema;
  await executeAdminStatement(connectionString, `create schema "${schema}"`);

  const scopedUrl = scopedConnectionString(connectionString, schema, applicationName);
  const db = createPooledDatabase(scopedUrl);

  try {
    // Kysely otherwise treats a migration table in any test schema as its own.
    const migrator = createMigrator(db, schema);
    const migration =
      migrateTo === undefined
        ? await migrator.migrateToLatest()
        : await migrator.migrateTo(migrateTo);
    if (migration.error !== undefined) throw migration.error;

    const results = migration.results ?? [];
    if (results.length === 0 || results.some((result) => result.status !== "Success")) {
      throw new Error("The initial migration did not complete successfully");
    }
  } catch (error) {
    await destroyDatabase(db).catch(() => undefined);
    await dropSchema(connectionString, schema).catch(() => undefined);
    throw error;
  }

  let disposed = false;
  return {
    db,
    connectionString: scopedUrl,
    schema,
    applicationName,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        await destroyDatabase(db);
      } finally {
        await dropSchema(connectionString, schema);
      }
    },
  };
}

export async function resetPostgresTestDatabase(db: Kysely<Database>): Promise<void> {
  await sql`
    truncate table
      source_health,
      tournament_instrument_links,
      reference_prices,
      forward_positions,
      quotes,
      model_mids,
      event_flags,
      instruments,
      listings,
      cron_runs,
      tournament_password_credentials,
      tournament_provenance_leaves,
      tournament_provenance_batches,
      tournament_aggregates,
      tournament_scores,
      tournament_resolution_notes,
      tournament_resolutions,
      tournament_forecast_events,
      tournament_buckets,
      tournament_questions,
      tournament_sessions,
      tournament_identities,
      tournament_users,
      rate_limits,
      comment_rate_limits,
      market_comments,
      settlements,
      marks,
      trades,
      holdings,
      users,
      markets,
      companies
    restart identity cascade
  `.execute(db);
}

export async function holdAdvisoryLock(
  testDatabase: PostgresTestDatabase,
  key: bigint,
): Promise<HeldAdvisoryLock> {
  const blocker = new Client({ connectionString: testDatabase.connectionString });
  await blocker.connect();
  await blocker.query("begin");

  try {
    await blocker.query("select pg_advisory_xact_lock($1::bigint)", [key.toString()]);
  } catch (error) {
    await blocker.query("rollback").catch(() => undefined);
    await blocker.end().catch(() => undefined);
    throw error;
  }

  let released = false;
  return {
    async waitForWaiter(timeoutMs = 5_000): Promise<void> {
      const observer = new Client({
        connectionString: testDatabase.connectionString,
      });
      await observer.connect();
      const deadline = Date.now() + timeoutMs;
      try {
        while (Date.now() < deadline) {
          const result = await observer.query<{ waiter_count: string }>(
            `select count(*)::text as waiter_count
               from pg_locks locks
               join pg_stat_activity activity on activity.pid = locks.pid
              where locks.locktype = 'advisory'
                and locks.granted = false
                and activity.application_name = $1`,
            [testDatabase.applicationName],
          );
          if (Number(result.rows[0]?.waiter_count ?? "0") > 0) return;
          await delay(10);
        }
      } finally {
        await observer.end();
      }
      throw new Error("Timed out waiting for the trade transaction to block");
    },
    async release(): Promise<void> {
      if (released) return;
      released = true;
      try {
        await blocker.query("commit");
      } finally {
        await blocker.end();
      }
    },
  };
}

/**
 * A two-outcome LMSR book, the shape a dealer binary trades on, with its
 * sequence-0 mark. Fixture only: the dealer lists real books itself.
 */
export async function createBinaryBook(
  db: Kysely<Database>,
  input: {
    readonly slug: string;
    readonly name?: string;
    readonly b?: number;
    readonly yesProbability?: number;
  },
): Promise<{ readonly company: CompanyRow; readonly market: MarketRow }> {
  const b = input.b ?? 100;
  const seeded = seedBinaryMarket(input.yesProbability ?? 0.5, b);
  return db.transaction().execute(async (transaction) => {
    const name = input.name ?? "Integration Market";
    const company = await transaction
      .insertInto("companies")
      .values({ name, slug: input.slug, logo_path: "/integration.svg" })
      .onConflict((conflict) => conflict.column("slug").doUpdateSet({ name }))
      .returningAll()
      .executeTakeFirstOrThrow();
    const market = await transaction
      .insertInto("markets")
      .values({
        company_id: company.id,
        status: "open",
        n_buckets: 2,
        bucket_grid_version: "binary-v1",
        metric_kind: "yes_probability",
        anchor_valuation: null,
        anchor_date: null,
        anchor_description: null,
        b,
        sigma: null,
        initial_q: [...seeded.q],
        q: [...seeded.q],
        current_metric: seeded.currentMetric,
        settled_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto("marks")
      .values({
        market_id: market.id,
        market_sequence: "0",
        trade_id: null,
        ts: sql<Date>`clock_timestamp()`,
        value: market.current_metric,
      })
      .execute();
    return { company, market };
  });
}

export interface TestTrader {
  /** The paper account (`users.id`). */
  readonly id: string;
  readonly tournamentUserId: string;
  readonly handle: string;
}

/** A development-provider tournament identity with its paper account open. */
export async function createTrader(db: Kysely<Database>, handle: string): Promise<TestTrader> {
  const tournamentUserId = await upsertIdentity(db, {
    provider: "dev",
    providerUserId: handle.toLowerCase(),
    handle,
    displayName: handle,
    avatarUrl: null,
    verified: false,
    providerCreatedAt: null,
  });
  return { id: await ensurePaperAccount(db, tournamentUserId), tournamentUserId, handle };
}

/** A `Cookie` header value carrying a fresh session for the tournament user. */
export async function sessionCookie(
  db: Kysely<Database>,
  tournamentUserId: string,
): Promise<string> {
  return `${TOURNAMENT_SESSION_COOKIE}=${await createTournamentSession(db, tournamentUserId)}`;
}
