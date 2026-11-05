/**
 * `npm run index:certificates`: every transcription under
 * data/index/certificates/ into `source_documents` (class `delaware_coi`, the
 * PDF's SHA-256 as content), `certificates` and `certificate_series`, then
 * the link to the print each one prices.
 *
 * Idempotent: a certificate is keyed by its document (registry URL and PDF
 * hash), and a transcription by its own SHA-256. A changed transcription of
 * an imported certificate is a correction: a new `certificates` row with its
 * series, the old row superseded, and a `corrections` row of kind `row`.
 * Nothing is updated in place.
 *
 * The print link (CERTIFICATE_PRINT_MATCH): the issuer's priced round
 * announced nearest the certificate's filing date, within 60 days before
 * and 120 days after it, gets the newest series' label and original issue
 * price, and the certificate as `price_source_id`. Two rounds equally near
 * link neither.
 */
import { createHash } from "node:crypto";

import { type Kysely, sql, type Transaction } from "kysely";

import type { Database } from "../../db/schema.js";
import { daysBetween } from "../../engine/index/mark.js";
import { METHODOLOGY_VERSION } from "../../engine/index/methodology.js";
import { sourceRank } from "../../engine/rulebook.js";
import { CERTIFICATE_PARSER_VERSION, type Certificate } from "../../ingest/parse/certificate.js";

export const CERTIFICATE_PRINT_MATCH = Object.freeze({
  before_days: 60,
  after_days: 120,
  rule: "The issuer's priced round (or IPO) announced nearest the certificate's filing date, from 60 days before it to 120 days after it, is the round the certificate prices; its newest series' original issue price is the round's price per share. Two rounds equally near: no link.",
});

/** Event types that are prints (rulebook: a priced round; for labs, an IPO). */
export const PRINT_EVENT_TYPES = ["priced_round", "ipo"] as const;

export interface CertificateImport {
  readonly issuer: string;
  readonly filedOn: string;
  readonly status: "new" | "unchanged" | "corrected";
  readonly certificateId: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function storeDocument(
  trx: Transaction<Database>,
  certificate: Certificate,
): Promise<string> {
  const values = {
    source_class: "delaware_coi" as const,
    source_rank: sourceRank("delaware_coi"),
    accession: null,
    document_url: certificate.purchase.url,
    filer_cik: null,
    filer_name: certificate.legal_name,
    fund_series_id: null,
    fund_series_name: null,
    form_type: `certificate of incorporation (${certificate.kind}), file ${certificate.file_number}`,
    filed_on: certificate.filed_on,
    period_end: null,
    fetched_at: new Date(`${certificate.purchase.bought_on}T00:00:00Z`),
    content_sha256: certificate.purchase.document_sha256,
    parser_version: CERTIFICATE_PARSER_VERSION,
  };
  const inserted = await trx
    .insertInto("source_documents")
    .values(values)
    .onConflict((conflict) => conflict.columns(["document_url", "content_sha256"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (inserted !== undefined) return inserted.id;
  const existing = await trx
    .selectFrom("source_documents")
    .select(["id", "source_class"])
    .where("document_url", "=", values.document_url)
    .where("content_sha256", "=", values.content_sha256)
    .executeTakeFirstOrThrow();
  if (existing.source_class !== "delaware_coi") {
    throw new Error(`${values.document_url} is stored as ${existing.source_class}`);
  }
  return existing.id;
}

async function insertCertificate(
  trx: Transaction<Database>,
  issuerId: string,
  documentId: string,
  certificate: Certificate,
  transcriptionSha256: string,
  correctionId: string | null,
): Promise<string> {
  const row = await trx
    .insertInto("certificates")
    .values({
      issuer_id: issuerId,
      document_id: documentId,
      filed_on: certificate.filed_on,
      kind: certificate.kind,
      entered_by:
        certificate.reviewed_by === null
          ? certificate.entered_by
          : `${certificate.entered_by}; reviewed by ${certificate.reviewed_by}`,
      notes: certificate.notes,
      newest_series_label: certificate.newest_series,
      transcription_sha256: transcriptionSha256,
      correction_id: correctionId,
      common_shares_authorized: certificate.common_shares_authorized,
      unmodelled_terms: JSON.stringify(certificate.unmodelled_terms),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("certificate_series")
    .values(
      certificate.series.map((series) => ({
        certificate_id: row.id,
        series_label: series.label,
        original_issue_price_usd: series.original_issue_price_usd,
        liquidation_multiple: series.liquidation_multiple,
        participating: series.participating,
        participation_cap_multiple: series.participation_cap_multiple,
        seniority: series.seniority,
        shares_authorized: series.shares_authorized,
        conversion_price_usd: series.conversion_price_usd,
        ratchet: series.ratchet === null ? null : JSON.stringify(series.ratchet),
      })),
    )
    .execute();
  return row.id;
}

/** Imports one transcription (`text` is the file as read, hashed as is). */
export async function importCertificate(
  db: Kysely<Database>,
  certificate: Certificate,
  text: string,
  now: () => Date = () => new Date(),
): Promise<CertificateImport> {
  const transcriptionSha256 = sha256(text);
  return db.transaction().execute(async (trx) => {
    const issuer = await trx
      .selectFrom("issuers")
      .select("id")
      .where("slug", "=", certificate.issuer)
      .executeTakeFirst();
    if (issuer === undefined) {
      throw new Error(`no issuer ${certificate.issuer}; run npm run index:watchlist first`);
    }
    const documentId = await storeDocument(trx, certificate);
    const live = await trx
      .selectFrom("certificates")
      .select(["id", "transcription_sha256"])
      .where("document_id", "=", documentId)
      .where("superseded_by", "is", null)
      .executeTakeFirst();
    const base = { issuer: certificate.issuer, filedOn: certificate.filed_on };
    if (live === undefined) {
      const id = await insertCertificate(
        trx,
        issuer.id,
        documentId,
        certificate,
        transcriptionSha256,
        null,
      );
      return { ...base, status: "new", certificateId: id };
    }
    if (live.transcription_sha256 === transcriptionSha256) {
      return { ...base, status: "unchanged", certificateId: live.id };
    }
    const correction = await trx
      .insertInto("corrections")
      .values({
        published_at: now(),
        methodology_version: METHODOLOGY_VERSION,
        kind: "row",
        summary: `Certificate of ${certificate.legal_name} filed ${certificate.filed_on} re-transcribed: its series are replaced by the corrected reading.`,
        diff_md: `Transcription SHA-256 ${live.transcription_sha256} → ${transcriptionSha256}.\n`,
        affected: JSON.stringify({ certificates: [live.id], issuer: certificate.issuer }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const id = await insertCertificate(
      trx,
      issuer.id,
      documentId,
      certificate,
      transcriptionSha256,
      correction.id,
    );
    await trx
      .updateTable("certificates")
      .set({ superseded_by: id })
      .where("id", "=", live.id)
      .execute();
    return { ...base, status: "corrected", certificateId: id };
  });
}

export interface PrintLink {
  readonly issuer: string;
  readonly certificateFiledOn: string;
  readonly roundName: string | null;
  readonly seriesLabel: string;
  readonly pricePerShareUsd: string;
  readonly reason: "linked" | "already_linked" | "no_round_in_window" | "two_rounds_equally_near";
}

/**
 * Links every live certificate to the print it prices (CERTIFICATE_PRINT_MATCH).
 * The newest series is the one the certificate's transcription names. When
 * two certificates price one round, the later-filed one stands.
 */
export async function linkCertificatePrints(db: Kysely<Database>): Promise<PrintLink[]> {
  const certificates = await db
    .selectFrom("certificates")
    .innerJoin("issuers", "issuers.id", "certificates.issuer_id")
    .select([
      "certificates.id",
      "certificates.issuer_id",
      "certificates.document_id",
      "certificates.filed_on",
      "issuers.slug",
    ])
    .where("certificates.superseded_by", "is", null)
    .orderBy("certificates.filed_on")
    .execute();
  const links: PrintLink[] = [];
  for (const certificate of certificates) {
    const newest = await newestSeries(db, certificate.id);
    if (newest === undefined) continue;
    const prints = await db
      .selectFrom("prints")
      .select(["id", "round_name", "announced_on", "price_source_id"])
      .where("issuer_id", "=", certificate.issuer_id)
      .where("event_type", "in", [...PRINT_EVENT_TYPES])
      .where(
        sql<boolean>`announced_on between ${certificate.filed_on}::date - ${CERTIFICATE_PRINT_MATCH.before_days}::int and ${certificate.filed_on}::date + ${CERTIFICATE_PRINT_MATCH.after_days}::int`,
      )
      .execute();
    const distances = prints
      .map((print) => ({
        print,
        days: Math.abs(daysBetween(certificate.filed_on, print.announced_on)),
      }))
      .sort((a, b) => a.days - b.days);
    const base = {
      issuer: certificate.slug,
      certificateFiledOn: certificate.filed_on,
      seriesLabel: newest.series_label,
      pricePerShareUsd: newest.original_issue_price_usd,
    };
    const nearest = distances[0];
    if (nearest === undefined) {
      links.push({ ...base, roundName: null, reason: "no_round_in_window" });
      continue;
    }
    if (distances[1] !== undefined && distances[1].days === nearest.days) {
      links.push({ ...base, roundName: null, reason: "two_rounds_equally_near" });
      continue;
    }
    if (nearest.print.price_source_id === certificate.document_id) {
      links.push({ ...base, roundName: nearest.print.round_name, reason: "already_linked" });
      continue;
    }
    await db
      .updateTable("prints")
      .set({
        series_label: newest.series_label,
        price_per_share_usd: newest.original_issue_price_usd,
        price_source_id: certificate.document_id,
      })
      .where("id", "=", nearest.print.id)
      .execute();
    links.push({ ...base, roundName: nearest.print.round_name, reason: "linked" });
  }
  return links;
}

/** The series a certificate creates, as its transcription names it. */
async function newestSeries(
  db: Kysely<Database>,
  certificateId: string,
): Promise<{ series_label: string; original_issue_price_usd: string } | undefined> {
  const row = await db
    .selectFrom("certificate_series")
    .innerJoin("certificates", "certificates.id", "certificate_series.certificate_id")
    .select(["certificate_series.series_label", "certificate_series.original_issue_price_usd"])
    .where("certificate_series.certificate_id", "=", certificateId)
    .where(sql<boolean>`certificate_series.series_label = certificates.newest_series_label`)
    .executeTakeFirst();
  return row;
}
