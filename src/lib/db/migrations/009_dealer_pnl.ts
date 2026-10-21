import { type Kysely, sql } from "kysely";

/**
 * Milestone 6's ledger additions (README D12, TECHNICAL_DESIGN.md §6).
 *
 * `quotes.sequence` orders the tape: one dealer run posts several quotes for
 * an instrument at the same `posted_at` (a widen, then the requote after the
 * mid moved), and the latest quote is the one the next requote compares with.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table quotes add column sequence bigint generated always as identity`.execute(db);
  await sql`create unique index quotes_sequence on quotes (sequence)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index quotes_sequence`.execute(db);
  await sql`alter table quotes drop column sequence`.execute(db);
}
