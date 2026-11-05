import { type Kysely, sql } from "kysely";

/**
 * A correction to a filer mark is a new row plus a `corrections` row
 * (docs/prompts/v2/README.md, "Data model"): the corrected row carries the
 * correction's id in `correction_id` and the row it corrects points
 * `superseded_by` at it. Migration 020 made a holding unique per document and
 * issuer, which left no room for the corrected row. Here a holding is unique
 * once as filed (`correction_id` null) and once per correction.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table filer_marks drop constraint filer_marks_document_issuer_holding
  `.execute(db);
  await sql`
    create unique index filer_marks_document_issuer_holding
    on filer_marks (document_id, issuer_id, holding_index)
    where correction_id is null
  `.execute(db);
  await sql`
    create unique index filer_marks_document_issuer_holding_correction
    on filer_marks (document_id, issuer_id, holding_index, correction_id)
    where correction_id is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index filer_marks_document_issuer_holding_correction`.execute(db);
  await sql`drop index filer_marks_document_issuer_holding`.execute(db);
  await sql`
    alter table filer_marks add constraint filer_marks_document_issuer_holding
    unique (document_id, issuer_id, holding_index)
  `.execute(db);
}
