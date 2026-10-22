import { type Kysely, sql } from "kysely";

/**
 * The reference API's keyed tier (README D14, TECHNICAL_DESIGN.md §8). A key
 * is shown once when `npm run api-key:create` mints it; only its SHA-256 is
 * stored. A keyed request draws on its key's per-minute quota instead of the
 * public per-network bucket; a revoked key is refused, never downgraded to
 * the public tier.
 *
 * `rate_limits` gains the `ref` scope for both buckets: `network:<hash>` for
 * public callers and `key:<id>` for keyed ones.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("api_keys")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("key_hash", "text", (column) => column.notNull().unique())
    .addColumn("quota_per_minute", "integer", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("revoked_at", "timestamptz")
    .addCheckConstraint("api_keys_name", sql`length(btrim(name)) between 1 and 100`)
    .addCheckConstraint("api_keys_key_hash", sql`key_hash ~ '^[0-9a-f]{64}$'`)
    .addCheckConstraint("api_keys_quota", sql`quota_per_minute > 0`)
    .addCheckConstraint(
      "api_keys_revoked_after_created",
      sql`revoked_at is null or revoked_at >= created_at`,
    )
    .execute();

  await db.schema.alterTable("rate_limits").dropConstraint("rate_limits_scope").execute();
  await db.schema
    .alterTable("rate_limits")
    .addCheckConstraint(
      "rate_limits_scope",
      sql`scope in ('quote', 'trade', 'tournament_register', 'tournament_login', 'ref')`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from rate_limits where scope = 'ref'`.execute(db);
  await db.schema.alterTable("rate_limits").dropConstraint("rate_limits_scope").execute();
  await db.schema
    .alterTable("rate_limits")
    .addCheckConstraint(
      "rate_limits_scope",
      sql`scope in ('quote', 'trade', 'tournament_register', 'tournament_login')`,
    )
    .execute();
  await db.schema.dropTable("api_keys").execute();
}
