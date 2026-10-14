import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("rate_limits")
    .addColumn("scope", "text", (column) => column.notNull())
    .addColumn("key", "text", (column) => column.notNull())
    .addColumn("window_started_at", "timestamptz", (column) => column.notNull())
    .addColumn("request_count", "integer", (column) => column.notNull())
    .addPrimaryKeyConstraint("rate_limits_primary_key", ["scope", "key"])
    .addCheckConstraint(
      "rate_limits_scope",
      sql`scope in ('admin_login', 'user_create', 'quote', 'trade')`,
    )
    .addCheckConstraint("rate_limits_nonnegative_count", sql`request_count >= 0`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("rate_limits").execute();
}
