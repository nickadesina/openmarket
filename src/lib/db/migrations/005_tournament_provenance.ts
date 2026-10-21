import { type Kysely, sql } from "kysely";

/**
 * Phase-2 provenance: each completed hour's forecast event hashes are
 * committed to one Merkle root, posted as a Solana memo. Leaves live in
 * their own table so forecast events stay append-only and untouched.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("tournament_provenance_batches")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("hour_start", "timestamptz", (column) => column.notNull().unique())
    .addColumn("root", "text", (column) => column.notNull())
    .addColumn("leaf_count", "integer", (column) => column.notNull())
    .addColumn("memo", "text", (column) => column.notNull())
    .addColumn("tx_signature", "text")
    .addColumn("posted_at", "timestamptz")
    .addColumn("confirmed_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      "tournament_provenance_batches_shape",
      sql`root ~ '^[0-9a-f]{64}$' and leaf_count > 0
        and date_trunc('hour', hour_start) = hour_start
        and (tx_signature is null) = (posted_at is null)
        and (confirmed_at is null or tx_signature is not null)`,
    )
    .execute();

  await db.schema
    .createTable("tournament_provenance_leaves")
    .addColumn("event_id", "uuid", (column) =>
      column.primaryKey().notNull().references("tournament_forecast_events.id"),
    )
    .addColumn("batch_id", "uuid", (column) =>
      column.notNull().references("tournament_provenance_batches.id"),
    )
    .addColumn("leaf_index", "integer", (column) => column.notNull())
    // Sibling hashes from leaf to root, each "L:<hex>" or "R:<hex>".
    .addColumn("path", sql`text[]`, (column) => column.notNull())
    .addUniqueConstraint("tournament_provenance_leaves_position", ["batch_id", "leaf_index"])
    .execute();

  await sql`
    create trigger tournament_provenance_leaves_append_only
    before update or delete on tournament_provenance_leaves
    for each row execute function tournament_reject_mutation()
  `.execute(db);

  // A batch's commitment never changes; only its posting fields move.
  await sql`
    create function tournament_provenance_batch_commitment() returns trigger language plpgsql as $$
    begin
      if tg_op = 'DELETE'
        or new.hour_start <> old.hour_start
        or new.root <> old.root
        or new.leaf_count <> old.leaf_count
        or new.memo <> old.memo then
        raise exception 'tournament_provenance_batches commitments are immutable';
      end if;
      return new;
    end
    $$
  `.execute(db);
  await sql`
    create trigger tournament_provenance_batches_commitment
    before update or delete on tournament_provenance_batches
    for each row execute function tournament_provenance_batch_commitment()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("tournament_provenance_leaves").execute();
  await db.schema.dropTable("tournament_provenance_batches").execute();
  await sql`drop function tournament_provenance_batch_commitment()`.execute(db);
}
