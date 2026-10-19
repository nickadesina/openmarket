import { type Kysely, sql } from "kysely";

/**
 * The log-scored forecasting tournament. Separate from the paper markets:
 * its own users (X identities), sessions, questions and ledger. The system
 * of record is forecast events plus resolutions; aggregates and scores are
 * derived and recomputable from them.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("tournament_users")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("flagged", "boolean", (column) => column.notNull().defaultTo(false))
    .addColumn("flag_reason", "text")
    .addCheckConstraint(
      "tournament_users_flag_reason",
      sql`(flagged and flag_reason is not null) or (not flagged and flag_reason is null)`,
    )
    .execute();

  await db.schema
    .createTable("tournament_identities")
    .addColumn("user_id", "uuid", (column) => column.notNull().references("tournament_users.id"))
    .addColumn("provider", "text", (column) => column.notNull())
    .addColumn("provider_user_id", "text", (column) => column.notNull())
    .addColumn("handle", "text", (column) => column.notNull())
    .addColumn("handle_normalized", "text", (column) => column.notNull())
    .addColumn("display_name", "text", (column) => column.notNull())
    .addColumn("avatar_url", "text")
    .addColumn("verified", "boolean", (column) => column.notNull().defaultTo(false))
    .addColumn("provider_created_at", "timestamptz")
    .addColumn("last_login_at", "timestamptz", (column) => column.notNull())
    .addPrimaryKeyConstraint("tournament_identities_primary_key", ["provider", "provider_user_id"])
    .addUniqueConstraint("tournament_identities_one_per_provider", ["user_id", "provider"])
    .addCheckConstraint("tournament_identities_provider", sql`provider in ('x', 'dev')`)
    .addCheckConstraint(
      "tournament_identities_handle_shape",
      sql`handle_normalized = lower(handle) and handle ~ '^[A-Za-z0-9_]{1,50}$'`,
    )
    .execute();

  await db.schema
    .createIndex("tournament_identities_handle")
    .on("tournament_identities")
    .columns(["handle_normalized", "last_login_at"])
    .execute();

  await db.schema
    .createTable("tournament_sessions")
    // SHA-256 of the opaque cookie token; the token itself is never stored.
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("user_id", "uuid", (column) => column.notNull().references("tournament_users.id"))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("expires_at", "timestamptz", (column) => column.notNull())
    .addCheckConstraint("tournament_sessions_id_shape", sql`id ~ '^[0-9a-f]{64}$'`)
    .execute();

  await db.schema
    .createTable("tournament_questions")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("slug", "text", (column) => column.notNull().unique())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("description_md", "text", (column) => column.notNull())
    .addColumn("rulebook_md", "text", (column) => column.notNull())
    .addColumn("rulebook_version", "integer", (column) => column.notNull())
    .addColumn("unit", "text", (column) => column.notNull())
    .addColumn("bucket_count", "smallint", (column) => column.notNull())
    .addColumn("opens_at", "timestamptz", (column) => column.notNull())
    .addColumn("closes_at", "timestamptz", (column) => column.notNull())
    .addColumn("expiry_at", "timestamptz", (column) => column.notNull())
    // Set by a manual early close (the resolution document arrived first);
    // the scoring window then ends here instead of at closes_at.
    .addColumn("closed_at", "timestamptz")
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("min_account_age_days", "integer", (column) => column.notNull().defaultTo(90))
    .addColumn("extremization", "double precision", (column) => column.notNull().defaultTo(1.5))
    .addColumn("x_thread_url", "text")
    .addColumn("void_note_md", "text")
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("tournament_questions_unit", sql`unit in ('USD_B', 'USD_T', 'bool')`)
    .addCheckConstraint(
      "tournament_questions_status",
      sql`status in ('draft', 'open', 'closed', 'resolved', 'voided')`,
    )
    .addCheckConstraint(
      "tournament_questions_window",
      sql`opens_at < closes_at and closes_at <= expiry_at`,
    )
    .addCheckConstraint(
      "tournament_questions_closed_at",
      sql`closed_at is null or (closed_at >= opens_at and closed_at <= closes_at)`,
    )
    .addCheckConstraint(
      "tournament_questions_binary_shape",
      sql`unit <> 'bool' or (bucket_count = 2 and expiry_at = closes_at)`,
    )
    .addCheckConstraint("tournament_questions_bucket_count", sql`bucket_count >= 2`)
    .addCheckConstraint("tournament_questions_extremization", sql`extremization > 0`)
    .addCheckConstraint("tournament_questions_account_age", sql`min_account_age_days >= 0`)
    .addCheckConstraint(
      "tournament_questions_void_note",
      sql`(status = 'voided') = (void_note_md is not null)`,
    )
    .execute();

  await db.schema
    .createTable("tournament_buckets")
    .addColumn("question_id", "uuid", (column) =>
      column.notNull().references("tournament_questions.id").onDelete("cascade"),
    )
    .addColumn("index", "smallint", (column) => column.notNull())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("lower", "numeric")
    .addColumn("upper", "numeric")
    .addColumn("label", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("tournament_buckets_primary_key", ["question_id", "index"])
    .addCheckConstraint("tournament_buckets_kind", sql`kind in ('range', 'floor')`)
    .addCheckConstraint(
      "tournament_buckets_floor_unbounded",
      sql`kind = 'range' or (lower is null and upper is null)`,
    )
    .addCheckConstraint(
      "tournament_buckets_ordered",
      sql`lower is null or upper is null or lower < upper`,
    )
    .execute();

  await db.schema
    .createIndex("tournament_buckets_one_floor")
    .unique()
    .on("tournament_buckets")
    .column("question_id")
    .where(sql<boolean>`kind = 'floor'`)
    .execute();

  await db.schema
    .createTable("tournament_forecast_events")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (column) => column.notNull().references("tournament_users.id"))
    .addColumn("question_id", "uuid", (column) =>
      column.notNull().references("tournament_questions.id"),
    )
    // Millisecond precision so timestamps round-trip through JavaScript exactly.
    .addColumn("submitted_at", sql`timestamptz(3)`, (column) => column.notNull())
    .addColumn("probs", sql`numeric[]`, (column) => column.notNull())
    .addColumn("client_hash", "text")
    // sha256(question_id || user_id || submitted_at || canonical probs), for phase-2 provenance.
    .addColumn("event_hash", "text", (column) => column.notNull())
    .addCheckConstraint(
      "tournament_forecast_events_probs_nonnegative",
      sql`0 <= all(probs) and array_ndims(probs) = 1`,
    )
    .addCheckConstraint(
      "tournament_forecast_events_hash_shape",
      sql`event_hash ~ '^[0-9a-f]{64}$' and (client_hash is null or char_length(client_hash) <= 128)`,
    )
    .execute();

  await db.schema
    .createIndex("tournament_forecast_events_latest")
    .on("tournament_forecast_events")
    .expression(sql`question_id, user_id, submitted_at desc`)
    .execute();
  await db.schema
    .createIndex("tournament_forecast_events_scoring")
    .on("tournament_forecast_events")
    .columns(["question_id", "submitted_at"])
    .execute();

  await db.schema
    .createTable("tournament_resolutions")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("question_id", "uuid", (column) =>
      column.notNull().references("tournament_questions.id"),
    )
    .addColumn("resolved_at", "timestamptz", (column) => column.notNull())
    .addColumn("winning_bucket_index", "smallint", (column) => column.notNull())
    .addColumn("resolved_value", "numeric")
    .addColumn("rung_fired", "smallint")
    .addColumn("source_url", "text")
    .addColumn("source_excerpt", "text")
    .addColumn("note_md", "text", (column) => column.notNull())
    .addColumn("resolver_user_id", "uuid", (column) =>
      column.notNull().references("tournament_users.id"),
    )
    // A dispute inside the window replaces the live row; the old one points at its successor.
    .addColumn("superseded_by", "uuid")
    // Deferred so the old row can point at its successor inside the same transaction.
    .addForeignKeyConstraint(
      "tournament_resolutions_superseded_by_fk",
      ["superseded_by"],
      "tournament_resolutions",
      ["id"],
      (constraint) => constraint.deferrable().initiallyDeferred(),
    )
    .addCheckConstraint(
      "tournament_resolutions_excerpt_length",
      sql`source_excerpt is null or char_length(source_excerpt) <= 500`,
    )
    .addCheckConstraint(
      "tournament_resolutions_rung",
      sql`rung_fired is null or rung_fired between 1 and 9`,
    )
    .execute();

  await db.schema
    .createIndex("tournament_resolutions_one_live")
    .unique()
    .on("tournament_resolutions")
    .column("question_id")
    .where(sql<boolean>`superseded_by is null`)
    .execute();

  await db.schema
    .createTable("tournament_resolution_notes")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("question_id", "uuid", (column) =>
      column.notNull().references("tournament_questions.id"),
    )
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("note_md", "text", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("tournament_scores")
    .addColumn("resolution_id", "uuid", (column) =>
      column.notNull().references("tournament_resolutions.id"),
    )
    .addColumn("user_id", "uuid", (column) => column.notNull().references("tournament_users.id"))
    .addColumn("question_id", "uuid", (column) =>
      column.notNull().references("tournament_questions.id"),
    )
    .addColumn("time_avg_log_score", "double precision", (column) => column.notNull())
    .addColumn("final_log_score", "double precision", (column) => column.notNull())
    .addColumn("coverage", "double precision", (column) => column.notNull())
    .addColumn("computed_at", "timestamptz", (column) => column.notNull())
    .addPrimaryKeyConstraint("tournament_scores_primary_key", ["resolution_id", "user_id"])
    .addCheckConstraint("tournament_scores_coverage", sql`coverage > 0 and coverage <= 1`)
    .execute();

  await db.schema
    .createIndex("tournament_scores_leaderboard")
    .on("tournament_scores")
    .expression(sql`question_id, time_avg_log_score desc`)
    .execute();

  await db.schema
    .createTable("tournament_aggregates")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("question_id", "uuid", (column) =>
      column.notNull().references("tournament_questions.id"),
    )
    .addColumn("computed_at", sql`timestamptz(3)`, (column) => column.notNull())
    .addColumn("probs", sql`numeric[]`)
    .addColumn("n_forecasters", "integer", (column) => column.notNull())
    .addColumn("median_value", "numeric")
    .addColumn("p_floor", "numeric")
    .addColumn("p_yes", "numeric")
    .addColumn("extremization", "double precision", (column) => column.notNull())
    .addColumn("weighting_version", "text", (column) => column.notNull())
    .addCheckConstraint(
      "tournament_aggregates_probs_present",
      sql`(n_forecasters = 0) = (probs is null)`,
    )
    .execute();

  await db.schema
    .createIndex("tournament_aggregates_history")
    .on("tournament_aggregates")
    .columns(["question_id", "computed_at"])
    .execute();

  // The system of record is append-only: forecast events and scores never
  // change, and a resolution may change only by being superseded once.
  await sql`
    create function tournament_reject_mutation() returns trigger language plpgsql as $$
    begin
      raise exception '% is append-only', tg_table_name;
    end
    $$
  `.execute(db);
  await sql`
    create function tournament_resolution_supersede_only() returns trigger language plpgsql as $$
    begin
      if tg_op = 'DELETE'
        or old.superseded_by is not null
        or new.superseded_by is null
        or (to_jsonb(new) - 'superseded_by') <> (to_jsonb(old) - 'superseded_by') then
        raise exception 'tournament_resolutions change only by being superseded';
      end if;
      return new;
    end
    $$
  `.execute(db);
  for (const table of ["tournament_forecast_events", "tournament_scores"]) {
    await sql`
      create trigger ${sql.raw(`${table}_append_only`)}
      before update or delete on ${sql.table(table)}
      for each row execute function tournament_reject_mutation()
    `.execute(db);
  }
  await sql`
    create trigger tournament_resolutions_supersede_only
    before update or delete on tournament_resolutions
    for each row execute function tournament_resolution_supersede_only()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "tournament_aggregates",
    "tournament_scores",
    "tournament_resolution_notes",
    "tournament_resolutions",
    "tournament_forecast_events",
    "tournament_buckets",
    "tournament_questions",
    "tournament_sessions",
    "tournament_identities",
    "tournament_users",
  ]) {
    await db.schema.dropTable(table).execute();
  }
  await sql`drop function tournament_resolution_supersede_only()`.execute(db);
  await sql`drop function tournament_reject_mutation()`.execute(db);
}
