import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { Kysely } from "kysely";
import {
  FileMigrationProvider,
  Migrator,
  type MigrationResultSet,
} from "kysely/migration";

import type { Database } from "./schema.js";

export const MIGRATION_FOLDER = fileURLToPath(
  new URL("./migrations", import.meta.url),
);

export function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: MIGRATION_FOLDER,
    }),
  });
}

export async function migrateToLatest(
  db: Kysely<Database>,
): Promise<MigrationResultSet> {
  return createMigrator(db).migrateToLatest();
}
