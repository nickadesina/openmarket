import { type Kysely, sql } from "kysely";

/** A source flag can be promoted once, independently of a caller's locking. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create unique index event_flags_promoted_from_unique on event_flags (promoted_from) where promoted_from is not null`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index event_flags_promoted_from_unique`.execute(db);
}
