import { type Kysely, sql } from "kysely";

/**
 * Key tiers for the reference API (docs/prompts/tradeables, item 5). A
 * `design_partner` key is the free trial: it carries an `expires_at` 365
 * days from creation and is refused once that passes. Every key minted
 * before this migration is `standard` and never expires.
 *
 * `api_key_usage` counts each key's served requests per UTC day, so
 * /admin/dealer can show the last seven days. The rate-limit table keeps
 * only the current minute. Counts only, no request content.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("api_keys")
    .addColumn("tier", "text", (column) => column.notNull().defaultTo("standard"))
    .addColumn("expires_at", "timestamptz")
    .execute();
  await db.schema
    .alterTable("api_keys")
    .addCheckConstraint("api_keys_tier", sql`tier in ('design_partner', 'standard')`)
    .execute();
  await db.schema
    .alterTable("api_keys")
    .addCheckConstraint(
      "api_keys_design_partner_expires",
      sql`tier <> 'design_partner' or expires_at is not null`,
    )
    .execute();
  await db.schema
    .alterTable("api_keys")
    .addCheckConstraint(
      "api_keys_expires_after_created",
      sql`expires_at is null or expires_at > created_at`,
    )
    .execute();

  await db.schema
    .createTable("api_key_usage")
    .addColumn("key_id", "uuid", (column) =>
      column.notNull().references("api_keys.id").onDelete("restrict"),
    )
    .addColumn("day", "date", (column) => column.notNull())
    .addColumn("request_count", "integer", (column) => column.notNull())
    .addPrimaryKeyConstraint("api_key_usage_primary_key", ["key_id", "day"])
    .addCheckConstraint("api_key_usage_positive", sql`request_count > 0`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("api_key_usage").execute();
  await db.schema.alterTable("api_keys").dropConstraint("api_keys_expires_after_created").execute();
  await db.schema
    .alterTable("api_keys")
    .dropConstraint("api_keys_design_partner_expires")
    .execute();
  await db.schema.alterTable("api_keys").dropConstraint("api_keys_tier").execute();
  await db.schema.alterTable("api_keys").dropColumn("expires_at").dropColumn("tier").execute();
}
