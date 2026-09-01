/**
 * Applies scripts/dev-seed.sql — a snapshot of real development trading
 * activity (Stripe and Anthropic markets, five paper accounts) — to the
 * database at DATABASE_URL_UNPOOLED. The target must be migrated and empty;
 * this refuses to touch a database that already has companies.
 *
 * Regenerate the snapshot from a database whose ledger passes verify:replay:
 *   pg_dump --data-only --column-inserts --exclude-table='kysely*' "$DATABASE_URL_UNPOOLED" > scripts/dev-seed.sql
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sql } from "kysely";

import {
  createDirectDatabase,
  destroyDatabase,
} from "../src/lib/db/client.js";

const seedPath = join(dirname(fileURLToPath(import.meta.url)), "dev-seed.sql");
const statements = readFileSync(seedPath, "utf8")
  .split("\n")
  // psql meta-commands (\restrict etc.) are not SQL; the driver cannot run them.
  .filter((line) => !line.startsWith("\\"))
  .join("\n");

const db = createDirectDatabase();
try {
  await db.transaction().execute(async (transaction) => {
    const existing = await transaction
      .selectFrom("companies")
      .select("id")
      .limit(1)
      .executeTakeFirst();
    if (existing !== undefined) {
      throw new Error(
        "Database already contains companies; refusing to seed. Point DATABASE_URL_UNPOOLED at an empty, migrated database.",
      );
    }
    await sql.raw(statements).execute(transaction);
  });
  console.log("Development seed applied.");
} finally {
  await destroyDatabase(db);
}
