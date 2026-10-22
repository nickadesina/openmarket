import { type Kysely, sql } from "kysely";

/**
 * The tournament bridge (milestone 7, TECHNICAL_DESIGN.md §7). Additive: no
 * row changes and nothing is dropped but one NOT NULL.
 *
 * - A linked question is resolved by the settle job, which is not a person:
 *   `tournament_resolutions.settle_run_id` names its run, and a resolution
 *   carries exactly one of a resolver and a run.
 * - `user_submitted` evidence records its submitter and what it claims to be
 *   (scoop, release, public S-1) in their own columns, so `terms_json` keeps
 *   the shape decision 0001 pins; every other kind has neither.
 * - An admin's review of a submission is an append-only row: confirmed,
 *   citing the later independent flag that confirms it, or rejected.
 * - Restricted persons (CONTRACTS.md): a forecaster's self-attestation of the
 *   listed names they work for, direct or have invested in, kept as an
 *   append-only history; the latest attestation is the one in force.
 * - `rate_limits` gains the `evidence` scope.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("tournament_resolutions")
    .addColumn("settle_run_id", "text", (column) => column.references("cron_runs.run_id"))
    .execute();
  await db.schema
    .alterTable("tournament_resolutions")
    .alterColumn("resolver_user_id", (column) => column.dropNotNull())
    .execute();
  await db.schema
    .alterTable("tournament_resolutions")
    .addCheckConstraint(
      "tournament_resolutions_one_resolver",
      sql`(resolver_user_id is null) <> (settle_run_id is null)`,
    )
    .execute();

  await db.schema
    .alterTable("event_flags")
    .addColumn("submitted_by", "uuid", (column) => column.references("tournament_users.id"))
    // What the submitter says the evidence is; the row's own kind stays user_submitted.
    .addColumn("submitted_kind", "text")
    .execute();
  await db.schema
    .alterTable("event_flags")
    .addCheckConstraint(
      "event_flags_submitter",
      sql`(kind = 'user_submitted') = (submitted_by is not null)
        and (kind = 'user_submitted') = (submitted_kind is not null)
        and (submitted_kind is null or submitted_kind in ('scoop', 'release', 's1_public'))`,
    )
    .execute();
  await db.schema
    .createIndex("event_flags_submitted_by")
    .on("event_flags")
    .columns(["submitted_by", "observed_at"])
    .where(sql<boolean>`submitted_by is not null`)
    .execute();

  await db.schema
    .createTable("event_flag_reviews")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("flag_id", "uuid", (column) =>
      column.notNull().unique().references("event_flags.id"),
    )
    .addColumn("decision", "text", (column) => column.notNull())
    .addColumn("confirming_flag_id", "uuid", (column) => column.references("event_flags.id"))
    .addColumn("reviewer_user_id", "uuid", (column) =>
      column.notNull().references("tournament_users.id"),
    )
    .addColumn("note", "text")
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("event_flag_reviews_decision", sql`decision in ('confirmed', 'rejected')`)
    .addCheckConstraint(
      "event_flag_reviews_confirmation",
      sql`(decision = 'confirmed') = (confirming_flag_id is not null)
        and confirming_flag_id is distinct from flag_id`,
    )
    .addCheckConstraint(
      "event_flag_reviews_note",
      sql`note is null or char_length(note) between 1 and 1000`,
    )
    .execute();

  await db.schema
    .createTable("tournament_restriction_attestations")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (column) => column.notNull().references("tournament_users.id"))
    .addColumn("attested_at", sql`timestamptz(3)`, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .execute();
  await db.schema
    .createIndex("tournament_restriction_attestations_latest")
    .on("tournament_restriction_attestations")
    .expression(sql`user_id, attested_at desc, id desc`)
    .execute();
  await db.schema
    .createTable("tournament_restriction_companies")
    .addColumn("attestation_id", "uuid", (column) =>
      column.notNull().references("tournament_restriction_attestations.id"),
    )
    .addColumn("company_id", "uuid", (column) => column.notNull().references("companies.id"))
    .addPrimaryKeyConstraint("tournament_restriction_companies_primary_key", [
      "attestation_id",
      "company_id",
    ])
    .execute();

  for (const table of [
    "event_flag_reviews",
    "tournament_restriction_attestations",
    "tournament_restriction_companies",
  ]) {
    await sql`
      create trigger ${sql.raw(`${table}_append_only`)}
      before update or delete on ${sql.table(table)}
      for each row execute function tournament_reject_mutation()
    `.execute(db);
  }

  await db.schema.alterTable("rate_limits").dropConstraint("rate_limits_scope").execute();
  await db.schema
    .alterTable("rate_limits")
    .addCheckConstraint(
      "rate_limits_scope",
      sql`scope in ('quote', 'trade', 'tournament_register', 'tournament_login', 'ref', 'evidence')`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from rate_limits where scope = 'evidence'`.execute(db);
  await db.schema.alterTable("rate_limits").dropConstraint("rate_limits_scope").execute();
  await db.schema
    .alterTable("rate_limits")
    .addCheckConstraint(
      "rate_limits_scope",
      sql`scope in ('quote', 'trade', 'tournament_register', 'tournament_login', 'ref')`,
    )
    .execute();

  await db.schema.dropTable("tournament_restriction_companies").execute();
  await db.schema.dropTable("tournament_restriction_attestations").execute();
  await db.schema.dropTable("event_flag_reviews").execute();

  await db.schema.dropIndex("event_flags_submitted_by").execute();
  await db.schema.alterTable("event_flags").dropConstraint("event_flags_submitter").execute();
  await db.schema
    .alterTable("event_flags")
    .dropColumn("submitted_kind")
    .dropColumn("submitted_by")
    .execute();

  // A run-resolved row has no resolver to restore; down refuses rather than invent one.
  await db.schema
    .alterTable("tournament_resolutions")
    .dropConstraint("tournament_resolutions_one_resolver")
    .execute();
  await db.schema
    .alterTable("tournament_resolutions")
    .alterColumn("resolver_user_id", (column) => column.setNotNull())
    .execute();
  await db.schema.alterTable("tournament_resolutions").dropColumn("settle_run_id").execute();
}
