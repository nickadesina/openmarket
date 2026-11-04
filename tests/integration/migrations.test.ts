import { readdirSync } from "node:fs";

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MIGRATION_FOLDER } from "../../src/lib/db/migrator.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * Production has run migrations 001-019, so every one of them stays in the
 * tree, in order, and still applies to an empty schema; v1's tables are left
 * in place (decision 0003) and v2 code reads none of them.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Migrations PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Migrations PostgreSQL integration";

const MIGRATIONS = readdirSync(MIGRATION_FOLDER)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => file.replace(/\.ts$/, ""))
  .sort();

describe("migration files", () => {
  it("keeps 001 through 019, numbered without a gap", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(19);
    MIGRATIONS.forEach((name, index) => {
      expect(name.slice(0, 4)).toBe(`${String(index + 1).padStart(3, "0")}_`);
    });
  });
});

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  it("applies every migration to an empty schema", async () => {
    const applied = await sql<{ name: string }>`
      select name from ${sql.table(`${postgres.schema}.kysely_migration`)} order by name
    `.execute(postgres.db);
    expect(applied.rows.map((row) => row.name)).toEqual(MIGRATIONS);
  });

  it("leaves the tables v2 reads in place", async () => {
    for (const table of ["api_keys", "api_key_usage", "rate_limits"]) {
      const found = await sql<{ present: boolean }>`
        select to_regclass(${`${postgres.schema}.${table}`}) is not null as present
      `.execute(postgres.db);
      expect(found.rows[0]?.present, table).toBe(true);
    }
  });
});
