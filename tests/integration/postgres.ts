import { randomUUID } from "node:crypto";

import { type Kysely, sql } from "kysely";
import { Client } from "pg";

import { createPooledDatabase, destroyDatabase } from "../../src/lib/db/client.js";
import { createMigrator } from "../../src/lib/db/migrator.js";
import type { Database } from "../../src/lib/db/schema.js";

export const TEST_DATABASE_SKIP_REASON =
  "DATABASE_URL_TEST is not set; PostgreSQL integration tests require a disposable database.";

export interface PostgresTestDatabase {
  readonly db: Kysely<Database>;
  readonly connectionString: string;
  readonly schema: string;
  readonly applicationName: string;
  dispose(): Promise<void>;
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

/**
 * Suites run in parallel, each in its own schema, but Kysely's migrator
 * introspects tables across every schema: a suite dropping its schema while
 * another migrates fails the migration with "schema … does not exist". One
 * session-level advisory lock serializes schema migration and teardown.
 */
const SCHEMA_DDL_LOCK = 7_340_211;

async function withSchemaDdlLock<T>(connectionString: string, work: () => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [SCHEMA_DDL_LOCK]);
    try {
      return await work();
    } finally {
      await client.query("select pg_advisory_unlock($1)", [SCHEMA_DDL_LOCK]);
    }
  } finally {
    await client.end();
  }
}

async function dropSchema(connectionString: string, schema: string): Promise<void> {
  await withSchemaDdlLock(connectionString, () =>
    executeAdminStatement(connectionString, `drop schema if exists "${schema}" cascade`),
  );
}

/** Migrates a test schema up or down under the schema DDL lock. */
export function migrateTestDatabase(
  postgres: PostgresTestDatabase,
  target: "latest" | string,
): ReturnType<ReturnType<typeof createMigrator>["migrateToLatest"]> {
  const migrator = createMigrator(postgres.db, postgres.schema);
  return withSchemaDdlLock(postgres.connectionString, () =>
    target === "latest" ? migrator.migrateToLatest() : migrator.migrateTo(target),
  );
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
    const migration = await withSchemaDdlLock(connectionString, () =>
      migrateTo === undefined ? migrator.migrateToLatest() : migrator.migrateTo(migrateTo),
    );
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
      ingest_runs,
      spv_quotes,
      spv_vehicles,
      certificate_series,
      certificates,
      prints,
      filer_marks,
      corrections,
      issuers,
      source_documents,
      event_flag_reviews,
      tournament_restriction_companies,
      tournament_restriction_attestations,
      api_keys,
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
      tournament_archived_forecast_vectors,
      tournament_forecast_events,
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
