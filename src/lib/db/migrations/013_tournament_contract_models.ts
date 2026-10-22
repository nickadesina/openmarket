import { type Kysely, sql } from "kysely";

/**
 * Tournament questions follow the dealer's two contracts (decision 0004).
 * A deliberate, owner-approved data change (Nick, 2026-10-22): it voids and
 * renames every live question.
 *
 * - A question is a `binary` (one p of YES) or a `forward` (one level in
 *   USD_B or USD_T). `bool` and `choice` questions become binaries with no
 *   unit, `USD_*` ladders become forwards. `bucket_count` and the bucket
 *   checks go, and so does `tournament_buckets`.
 * - Bucket forecasts cannot be rescored as a p or a level, and open
 *   rulebooks are pinned, so every question not already voided or resolved
 *   is voided, renamed `<slug>-v1`, and given a note naming the replacement
 *   that the seed then opens under the canonical slug. A void writes no scores.
 * - Forecast events carry `p` or `value`, exactly one on every new row; the
 *   check is `not valid` so legacy rows, which carry neither, are exempt.
 *   Their bucket vectors are archived, not deleted, in the append-only
 *   `tournament_archived_forecast_vectors`: each event's `event_hash` is a
 *   hash of its vector and every posted Merkle root commits to those hashes,
 *   so the proof page must still recompute them. No event row is updated or
 *   deleted; the append-only trigger never fires.
 * - Aggregates are derived: every row goes, and the next write recomputes
 *   them as one `p` or one `value`.
 * - A resolution carries a binary's `outcome` or a forward's
 *   `resolved_value`, never a winning bucket.
 *
 * It refuses to run once a question has resolved or scored, or once a
 * reference price cites a crowd aggregate: those rows are bucket-shaped and
 * not this migration's to rewrite.
 *
 * `down` restores the 012 shape on a tournament with no questions only;
 * bucket forecasts cannot be rebuilt from a p or a level.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    do $$
    begin
      if exists (select 1 from tournament_resolutions) then
        raise exception '013 runs before any tournament resolution: tournament_resolutions has rows';
      end if;
      if exists (select 1 from tournament_scores) then
        raise exception '013 runs before any tournament score: tournament_scores has rows';
      end if;
      if exists (
        select 1 from reference_prices
        where components_json -> 'crowd' ->> 'aggregate_id' is not null
      ) then
        raise exception '013 runs before the blend cites the crowd: a reference price cites a tournament aggregate';
      end if;
    end
    $$
  `.execute(db);

  await migrateQuestions(db);
  await archiveForecastVectors(db);
  await migrateAggregates(db);
  await db.schema.dropTable("tournament_buckets").execute();
  await migrateResolutions(db);
}

async function migrateQuestions(db: Kysely<unknown>): Promise<void> {
  for (const constraint of [
    "tournament_questions_binary_shape",
    "tournament_questions_bucket_count",
    "tournament_questions_unit",
  ]) {
    await db.schema.alterTable("tournament_questions").dropConstraint(constraint).execute();
  }
  await db.schema.alterTable("tournament_questions").dropColumn("bucket_count").execute();

  await db.schema.alterTable("tournament_questions").addColumn("kind", "text").execute();
  await db.schema
    .alterTable("tournament_questions")
    .alterColumn("unit", (column) => column.dropNotNull())
    .execute();
  await sql`
    update tournament_questions
    set kind = case when unit in ('USD_B', 'USD_T') then 'forward' else 'binary' end,
        unit = case when unit in ('USD_B', 'USD_T') then unit end
  `.execute(db);
  await db.schema
    .alterTable("tournament_questions")
    .alterColumn("kind", (column) => column.setNotNull())
    .execute();
  await db.schema
    .alterTable("tournament_questions")
    .addCheckConstraint("tournament_questions_kind", sql`kind in ('binary', 'forward')`)
    .execute();
  await db.schema
    .alterTable("tournament_questions")
    .addCheckConstraint("tournament_questions_unit", sql`unit in ('USD_B', 'USD_T')`)
    .execute();
  await db.schema
    .alterTable("tournament_questions")
    .addCheckConstraint(
      "tournament_questions_kind_unit",
      sql`(kind = 'forward') = (unit is not null)`,
    )
    .execute();

  // Every expression reads the row before the update, so the note names the
  // original slug unless 0004 opens its replacement under another one.
  const renamed = sql.join(
    Object.entries(REPLACEMENT_SLUGS).map(
      ([original, replacement]) => sql`(${original}, ${replacement})`,
    ),
  );
  await sql`
    update tournament_questions
    set status = 'voided',
        slug = slug || '-v1',
        void_note_md = 'Replaced by the ' || kind || ' question at /t/q/'
          || coalesce(
            (select r.replacement from (values ${renamed}) as r (original, replacement)
             where r.original = tournament_questions.slug),
            slug
          )
          || '; bucket forecasts are not scored.'
    where status not in ('voided', 'resolved')
  `.execute(db);
}

/**
 * Production slugs whose replacement opens under a different canonical slug
 * (0004 → "The questions after the change"). Every other voided question is
 * replaced under its own slug: the seed's two forwards, and a linked
 * question, which the dealer's list step relinks under the bridge's slug.
 */
const REPLACEMENT_SLUGS: Readonly<Record<string, string>> = {
  "openai-round-vs-anthropic-ipo": "openai-round-before-anthropic-ipo",
};

async function archiveForecastVectors(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("tournament_archived_forecast_vectors")
    .addColumn("event_id", "uuid", (column) =>
      column.primaryKey().notNull().references("tournament_forecast_events.id"),
    )
    .addColumn("probs", sql`numeric[]`, (column) => column.notNull())
    .addCheckConstraint(
      "tournament_archived_forecast_vectors_probs_nonnegative",
      sql`0 <= all(probs) and array_ndims(probs) = 1`,
    )
    .execute();
  await sql`
    create trigger tournament_archived_forecast_vectors_append_only
    before update or delete on tournament_archived_forecast_vectors
    for each row execute function tournament_reject_mutation()
  `.execute(db);
  await sql`
    insert into tournament_archived_forecast_vectors (event_id, probs)
    select id, probs from tournament_forecast_events
  `.execute(db);

  await db.schema
    .alterTable("tournament_forecast_events")
    .addColumn("p", "numeric")
    .addColumn("value", "numeric")
    .execute();
  await db.schema
    .alterTable("tournament_forecast_events")
    .addCheckConstraint("tournament_forecast_events_p", sql`p is null or (p > 0 and p < 1)`)
    .execute();
  await db.schema
    .alterTable("tournament_forecast_events")
    .addCheckConstraint("tournament_forecast_events_value", sql`value is null or value > 0`)
    .execute();
  // Not valid: legacy rows carry neither and keep their archived vector; every new row is checked.
  await sql`
    alter table tournament_forecast_events
    add constraint tournament_forecast_events_one_payload
    check (num_nonnulls(p, value) = 1) not valid
  `.execute(db);
  await db.schema
    .alterTable("tournament_forecast_events")
    .dropConstraint("tournament_forecast_events_probs_nonnegative")
    .execute();
  await db.schema.alterTable("tournament_forecast_events").dropColumn("probs").execute();
}

async function migrateAggregates(db: Kysely<unknown>): Promise<void> {
  await sql`delete from tournament_aggregates`.execute(db);
  await db.schema
    .alterTable("tournament_aggregates")
    .dropConstraint("tournament_aggregates_probs_present")
    .execute();
  await db.schema
    .alterTable("tournament_aggregates")
    .dropColumn("probs")
    .dropColumn("median_value")
    .dropColumn("p_floor")
    .dropColumn("p_yes")
    .execute();
  await db.schema
    .alterTable("tournament_aggregates")
    .addColumn("p", "numeric")
    .addColumn("value", "numeric")
    .execute();
  await db.schema
    .alterTable("tournament_aggregates")
    .addCheckConstraint(
      "tournament_aggregates_payload",
      sql`(n_forecasters = 0 and num_nonnulls(p, value) = 0)
        or (n_forecasters > 0 and num_nonnulls(p, value) = 1)`,
    )
    .execute();
  await db.schema
    .alterTable("tournament_aggregates")
    .addCheckConstraint(
      "tournament_aggregates_ranges",
      sql`(p is null or (p >= 0 and p <= 1)) and (value is null or value > 0)`,
    )
    .execute();
}

async function migrateResolutions(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("tournament_resolutions").dropColumn("winning_bucket_index").execute();
  await db.schema.alterTable("tournament_resolutions").addColumn("outcome", "text").execute();
  await db.schema
    .alterTable("tournament_resolutions")
    .addCheckConstraint("tournament_resolutions_outcome", sql`outcome in ('yes', 'no')`)
    .execute();
  await db.schema
    .alterTable("tournament_resolutions")
    .addCheckConstraint(
      "tournament_resolutions_one_result",
      sql`num_nonnulls(outcome, resolved_value) = 1`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    do $$
    begin
      if exists (select 1 from tournament_questions) then
        raise exception '013 down runs only without tournament questions: bucket forecasts cannot be rebuilt';
      end if;
    end
    $$
  `.execute(db);

  await db.schema
    .alterTable("tournament_resolutions")
    .dropConstraint("tournament_resolutions_one_result")
    .execute();
  await db.schema
    .alterTable("tournament_resolutions")
    .dropConstraint("tournament_resolutions_outcome")
    .execute();
  await db.schema.alterTable("tournament_resolutions").dropColumn("outcome").execute();
  await db.schema
    .alterTable("tournament_resolutions")
    .addColumn("winning_bucket_index", "smallint", (column) => column.notNull())
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
    .alterTable("tournament_aggregates")
    .dropConstraint("tournament_aggregates_ranges")
    .execute();
  await db.schema
    .alterTable("tournament_aggregates")
    .dropConstraint("tournament_aggregates_payload")
    .execute();
  await db.schema.alterTable("tournament_aggregates").dropColumn("p").dropColumn("value").execute();
  await db.schema
    .alterTable("tournament_aggregates")
    .addColumn("probs", sql`numeric[]`)
    .addColumn("median_value", "numeric")
    .addColumn("p_floor", "numeric")
    .addColumn("p_yes", "numeric")
    .execute();
  await db.schema
    .alterTable("tournament_aggregates")
    .addCheckConstraint(
      "tournament_aggregates_probs_present",
      sql`(n_forecasters = 0) = (probs is null)`,
    )
    .execute();

  await db.schema.dropTable("tournament_archived_forecast_vectors").execute();
  for (const constraint of [
    "tournament_forecast_events_one_payload",
    "tournament_forecast_events_value",
    "tournament_forecast_events_p",
  ]) {
    await db.schema.alterTable("tournament_forecast_events").dropConstraint(constraint).execute();
  }
  await db.schema
    .alterTable("tournament_forecast_events")
    .dropColumn("p")
    .dropColumn("value")
    .execute();
  await db.schema
    .alterTable("tournament_forecast_events")
    .addColumn("probs", sql`numeric[]`, (column) => column.notNull())
    .execute();
  await db.schema
    .alterTable("tournament_forecast_events")
    .addCheckConstraint(
      "tournament_forecast_events_probs_nonnegative",
      sql`0 <= all(probs) and array_ndims(probs) = 1`,
    )
    .execute();

  for (const constraint of [
    "tournament_questions_kind_unit",
    "tournament_questions_unit",
    "tournament_questions_kind",
  ]) {
    await db.schema.alterTable("tournament_questions").dropConstraint(constraint).execute();
  }
  await db.schema.alterTable("tournament_questions").dropColumn("kind").execute();
  await db.schema
    .alterTable("tournament_questions")
    .alterColumn("unit", (column) => column.setNotNull())
    .execute();
  await db.schema
    .alterTable("tournament_questions")
    .addColumn("bucket_count", "smallint", (column) => column.notNull())
    .execute();
  await db.schema
    .alterTable("tournament_questions")
    .addCheckConstraint(
      "tournament_questions_unit",
      sql`unit in ('USD_B', 'USD_T', 'bool', 'choice')`,
    )
    .execute();
  await db.schema
    .alterTable("tournament_questions")
    .addCheckConstraint(
      "tournament_questions_binary_shape",
      sql`unit <> 'bool' or (bucket_count = 2 and expiry_at = closes_at)`,
    )
    .execute();
  await db.schema
    .alterTable("tournament_questions")
    .addCheckConstraint("tournament_questions_bucket_count", sql`bucket_count >= 2`)
    .execute();
}
