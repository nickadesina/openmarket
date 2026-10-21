import { type Kysely, sql } from "kysely";

/**
 * Self-reported affiliations, and username/password as a second sign-in
 * provider beside X. Password accounts reuse the identities table with
 * provider 'password'; their credentials live apart from it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("tournament_users").addColumn("affiliation", "text").execute();
  await db.schema
    .alterTable("tournament_users")
    .addCheckConstraint(
      "tournament_users_affiliation_shape",
      sql`affiliation is null or (affiliation = btrim(affiliation) and char_length(affiliation) between 1 and 60)`,
    )
    .execute();

  await db.schema
    .alterTable("tournament_identities")
    .dropConstraint("tournament_identities_provider")
    .execute();
  await db.schema
    .alterTable("tournament_identities")
    .addCheckConstraint("tournament_identities_provider", sql`provider in ('x', 'dev', 'password')`)
    .execute();

  await db.schema
    .createTable("tournament_password_credentials")
    .addColumn("user_id", "uuid", (column) =>
      column.primaryKey().notNull().references("tournament_users.id"),
    )
    .addColumn("username_normalized", "text", (column) => column.notNull().unique())
    // scrypt$16384$8$1$<salt>$<key>, the format the admin passphrase already uses.
    .addColumn("password_hash", "text", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      "tournament_password_credentials_username",
      sql`username_normalized ~ '^[a-z0-9_]{3,20}$'`,
    )
    .addCheckConstraint(
      "tournament_password_credentials_hash",
      sql`password_hash like 'scrypt$16384$8$1$%'`,
    )
    .execute();

  await db.schema.alterTable("rate_limits").dropConstraint("rate_limits_scope").execute();
  await db.schema
    .alterTable("rate_limits")
    .addCheckConstraint(
      "rate_limits_scope",
      sql`scope in ('admin_login', 'user_create', 'quote', 'trade', 'tournament_register', 'tournament_login')`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("rate_limits").dropConstraint("rate_limits_scope").execute();
  await db.schema
    .alterTable("rate_limits")
    .addCheckConstraint(
      "rate_limits_scope",
      sql`scope in ('admin_login', 'user_create', 'quote', 'trade')`,
    )
    .execute();
  await db.schema.dropTable("tournament_password_credentials").execute();
  await db.schema
    .alterTable("tournament_identities")
    .dropConstraint("tournament_identities_provider")
    .execute();
  await db.schema
    .alterTable("tournament_identities")
    .addCheckConstraint("tournament_identities_provider", sql`provider in ('x', 'dev')`)
    .execute();
  await db.schema.alterTable("tournament_users").dropColumn("affiliation").execute();
}
