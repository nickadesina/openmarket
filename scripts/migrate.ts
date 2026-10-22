import { userInfo } from "node:os";

import { Client } from "pg";

import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { migrateToLatest } from "../src/lib/db/migrator.js";

async function prepareLocalTestDatabase(): Promise<string> {
  const connectionString =
    process.env.DATABASE_URL_TEST?.trim() ||
    `postgresql://${encodeURIComponent(process.env.USER || userInfo().username)}@localhost:5432/openmarket_test`;
  const adminUrl = new URL(connectionString);
  if (adminUrl.protocol !== "postgresql:" && adminUrl.protocol !== "postgres:") {
    throw new Error("DATABASE_URL_TEST must be a PostgreSQL URL");
  }
  const databaseName = decodeURIComponent(adminUrl.pathname.slice(1));
  if (databaseName.length === 0) throw new Error("DATABASE_URL_TEST must name a database");
  adminUrl.pathname = "/postgres";
  const client = new Client({ connectionString: adminUrl.toString() });
  try {
    await client.connect();
    try {
      await client.query(`create database "${databaseName.replaceAll('"', '""')}"`);
    } catch (error) {
      // duplicate_database is the only acceptable creation failure.
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "42P04"
      ) {
        throw error;
      }
    }
  } finally {
    await client.end();
  }
  return connectionString;
}

async function main(): Promise<void> {
  const connectionString = process.argv.includes("--test-local")
    ? await prepareLocalTestDatabase()
    : undefined;
  const db = createDirectDatabase(connectionString);

  try {
    const { error, results } = await migrateToLatest(db);

    for (const result of results ?? []) {
      const direction = result.direction.toLowerCase();
      console.log(`${result.status}: ${direction} migration ${result.migrationName}`);
    }

    if (error !== undefined) {
      throw error;
    }

    if ((results?.length ?? 0) === 0) {
      console.log("Database is already at the latest migration");
    }
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch {
  console.error("Database migration failed; no credentials or database error details were logged.");
  process.exitCode = 1;
}
