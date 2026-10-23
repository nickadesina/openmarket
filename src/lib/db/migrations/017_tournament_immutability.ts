import { type Kysely, sql } from "kysely";

/** Derived rows cited by published references and recorded resolution notes are append-only. */
export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of ["tournament_aggregates", "tournament_resolution_notes"]) {
    await sql`create trigger ${sql.id(`${table}_append_only`)}
      before update or delete on ${sql.id(table)}
      for each row execute function tournament_reject_mutation()`.execute(db);
  }
  await sql`create function tournament_preserve_void_note() returns trigger language plpgsql as $$
    begin
      if old.void_note_md is not null and (tg_op = 'DELETE' or new.void_note_md is distinct from old.void_note_md) then
        raise exception 'tournament question void notes are immutable';
      end if;
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end
  $$`.execute(db);
  await sql`create trigger tournament_questions_void_note_immutable
    before update or delete on tournament_questions
    for each row execute function tournament_preserve_void_note()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ["tournament_aggregates", "tournament_resolution_notes"]) {
    await sql`drop trigger ${sql.id(`${table}_append_only`)} on ${sql.id(table)}`.execute(db);
  }
  await sql`drop trigger tournament_questions_void_note_immutable on tournament_questions`.execute(
    db,
  );
  await sql`drop function tournament_preserve_void_note()`.execute(db);
}
