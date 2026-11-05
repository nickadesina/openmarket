import { type Kysely, sql } from "kysely";

/**
 * Three things a certificate transcription carries that migration 020 had
 * no column for (docs/prompts/v2/p4-certificates-prints-spv.md): the series
 * the filing creates (its original issue price is the round's certificate
 * price), the common shares authorized, and the terms the transcriber found that the
 * common-equivalent conversion does not model (cumulative dividends,
 * redemption, pay-to-play…), which make it `unsupported`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table certificates
      add column newest_series_label text not null check (length(btrim(newest_series_label)) > 0),
      add column common_shares_authorized numeric check (common_shares_authorized >= 0),
      add column unmodelled_terms jsonb not null default '[]'
        check (jsonb_typeof(unmodelled_terms) = 'array')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table certificates drop column unmodelled_terms, drop column common_shares_authorized,
      drop column newest_series_label
  `.execute(db);
}
