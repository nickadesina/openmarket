import { type Kysely, sql } from "kysely";

/**
 * P4's additions to the marks index (docs/prompts/v2/p4-certificates-prints-spv.md).
 *
 * Certificates are corrected like marks: a changed transcription of an
 * imported certificate is a new `certificates` row (with its series), the old
 * one points `superseded_by` at it and the new one carries the correction's
 * id. `transcription_sha256` is the SHA-256 of the transcription as imported,
 * so a changed file is seen. The table is empty until a certificate is
 * transcribed.
 *
 * An issuer's listing: the date of its final IPO prospectus on EDGAR and the
 * prospectus's URL, from data/index/watchlist.json. Marks as of that date or
 * later are marks on listed stock, not private marks (METHODOLOGY.md,
 * "Listed names").
 *
 * One quote per captured page and issuer.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table certificates
      add column transcription_sha256 text not null
        check (transcription_sha256 ~ '^[0-9a-f]{64}$'),
      add column superseded_by uuid references certificates (id),
      add column correction_id uuid references corrections (id),
      add column created_at timestamptz not null default now(),
      add constraint certificates_not_self_superseded
        check (superseded_by is null or superseded_by <> id)
  `.execute(db);

  await sql`
    alter table issuers
      add column listed_on date,
      add column listing_url text check (listing_url ~ '^https://'),
      add constraint issuers_listing_sourced check ((listed_on is null) = (listing_url is null))
  `.execute(db);

  await sql`
    alter table spv_quotes
      add constraint spv_quotes_document_issuer unique (document_id, issuer_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table spv_quotes drop constraint spv_quotes_document_issuer`.execute(db);
  await sql`
    alter table issuers
      drop constraint issuers_listing_sourced,
      drop column listing_url,
      drop column listed_on
  `.execute(db);
  await sql`
    alter table certificates
      drop constraint certificates_not_self_superseded,
      drop column created_at,
      drop column correction_id,
      drop column superseded_by,
      drop column transcription_sha256
  `.execute(db);
}
