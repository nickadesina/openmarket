import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { migrateToLatest } from "../src/lib/db/migrator.js";

async function main(): Promise<void> {
  const db = createDirectDatabase();

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
