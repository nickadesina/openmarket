import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("market_comments")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("market_id", "uuid", (column) => column.notNull().references("markets.id"))
    .addColumn("user_id", "uuid", (column) => column.notNull().references("users.id"))
    .addColumn("parent_id", "uuid")
    .addColumn("body", "text")
    .addColumn("client_request_id", "uuid", (column) => column.notNull().unique())
    .addColumn("request_fingerprint", "text", (column) => column.notNull())
    // Cursor dates round-trip through JavaScript without losing ordering precision.
    .addColumn("created_at", sql`timestamptz(3)`, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("removed_at", sql`timestamptz(3)`)
    .addUniqueConstraint("market_comments_id_market_unique", ["id", "market_id"])
    .addForeignKeyConstraint(
      "market_comments_parent_market_fk",
      ["parent_id", "market_id"],
      "market_comments",
      ["id", "market_id"],
    )
    .addCheckConstraint("market_comments_not_own_parent", sql`parent_id is null or parent_id <> id`)
    .addCheckConstraint(
      "market_comments_body_state",
      sql`(removed_at is null and body is not null and char_length(body) between 1 and 2000)
        or (removed_at is not null and body is null)`,
    )
    .addCheckConstraint(
      "market_comments_fingerprint_shape",
      sql`request_fingerprint ~ '^[0-9a-f]{64}$'`,
    )
    .execute();

  await db.schema
    .createIndex("market_comments_thread_order")
    .on("market_comments")
    .columns(["market_id", "parent_id", "created_at", "id"])
    .execute();

  await db.schema
    .createTable("comment_rate_limits")
    .addColumn("scope", "text", (column) => column.notNull())
    .addColumn("key", "text", (column) => column.notNull())
    .addColumn("window_started_at", "timestamptz", (column) => column.notNull())
    .addColumn("post_count", "integer", (column) => column.notNull())
    .addPrimaryKeyConstraint("comment_rate_limits_primary_key", ["scope", "key"])
    .addCheckConstraint("comment_rate_limits_scope", sql`scope in ('user', 'network')`)
    .addCheckConstraint("comment_rate_limits_nonnegative_count", sql`post_count >= 0`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("comment_rate_limits").execute();
  await db.schema.dropTable("market_comments").execute();
}
