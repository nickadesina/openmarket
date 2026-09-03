/**
 * Applies scripts/dev-seed.sql — a snapshot of scripted development trading
 * (Stripe and Anthropic markets, eight paper accounts, sixteen days) — to the
 * database at DATABASE_URL_UNPOOLED. The target must be migrated and empty;
 * this refuses to touch a database that already has companies.
 *
 * The snapshot's timestamps are shifted so its last trade lands a few
 * minutes before now: a snapshot applied a week after it was taken would
 * otherwise show empty hour and day windows. Pass --keep-timestamps to
 * apply it verbatim.
 *
 * Rebuild the data with `npm run reseed:dev` (real anchors, scripted
 * two-week trading narrative), confirm `npm run verify:replay` passes, then
 * regenerate the snapshot with scripts/dump-dev-seed.sh.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sql } from "kysely";

import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";

const seedPath = join(dirname(fileURLToPath(import.meta.url)), "dev-seed.sql");
const statements = readFileSync(seedPath, "utf8")
  .split("\n")
  // psql meta-commands (\restrict etc.) are not SQL; the driver cannot run them.
  .filter((line) => !line.startsWith("\\"))
  .join("\n");

const keepTimestamps = process.argv.includes("--keep-timestamps");
const REBASE_LAG_MS = 14 * 60_000;

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

    if (!keepTimestamps) {
      // The snapshot resets search_path, so every table here is schema-qualified.
      const latest = await sql<{
        latest: Date | null;
      }>`select max(created_at) as latest from public.trades`
        .execute(transaction)
        .then((result) => result.rows[0]);
      const shiftMs = latest?.latest ? Date.now() - REBASE_LAG_MS - latest.latest.getTime() : 0;
      if (shiftMs > 0) {
        const shift = sql`make_interval(secs => ${shiftMs / 1000})`;
        await sql`update public.trades set created_at = created_at + ${shift}`.execute(transaction);
        await sql`update public.marks set ts = ts + ${shift}`.execute(transaction);
        await sql`update public.holdings set updated_at = updated_at + ${shift}`.execute(
          transaction,
        );
        await sql`update public.settlements set ts = ts + ${shift}`.execute(transaction);
        await sql`update public.markets set created_at = created_at + ${shift}, settled_at = settled_at + ${shift}`.execute(
          transaction,
        );
        await sql`update public.companies set created_at = created_at + ${shift}`.execute(
          transaction,
        );
        await sql`update public.users set created_at = created_at + ${shift}`.execute(transaction);
        console.log(
          `Snapshot timestamps shifted forward by ${(shiftMs / 3_600_000).toFixed(1)} hours.`,
        );
      }
    }
  });
  console.log("Development seed applied.");
} finally {
  await destroyDatabase(db);
}
