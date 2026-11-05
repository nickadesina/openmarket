/**
 * One Delaware certificate of incorporation, transcribed:
 * `data/index/certificates/<issuer slug>/<filed_on>.json`. This schema is the
 * spec (data/index/certificates/README.md explains each field). The PDF is
 * bought from the Division of Corporations and read by Nick, or by a model
 * and reviewed by Nick; it is not committed, its SHA-256 is.
 *
 * Amounts are decimal strings, as the certificate states them, so nothing
 * passes through a float before the database. Series labels are the
 * methodology's (`Series F-1 Preferred`), so a series meets the marks filed
 * on it.
 */
import { z } from "zod";

import { COMMON, isComparableLabel } from "../../engine/index/series.js";

export const CERTIFICATE_SCHEMA_VERSION = "0.1.0";
export const CERTIFICATE_PARSER_VERSION = `certificate-${CERTIFICATE_SCHEMA_VERSION}`;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DECIMAL = /^\d+(?:\.\d+)?$/;

const decimal = z.string().regex(DECIMAL, 'a decimal string such as "12.5"');
const positive = decimal.refine((value) => Number(value) > 0, "must be above zero");

const seriesSchema = z
  .object({
    /** The methodology's label: `Series F-1 Preferred`. */
    label: z
      .string()
      .refine(
        (label) => isComparableLabel(label) && label !== COMMON,
        "label must read like `Series F-1 Preferred`",
      ),
    original_issue_price_usd: positive,
    /** 1 for a 1× preference. */
    liquidation_multiple: decimal,
    participating: z.boolean(),
    /** Total proceeds as a multiple of original issue price; participating series only. */
    participation_cap_multiple: positive.nullable(),
    /** 1 is the most senior; equal numbers rank pari passu. */
    seniority: z.number().int().min(1),
    shares_authorized: decimal,
    /** Null when it equals the original issue price. */
    conversion_price_usd: positive.nullable(),
    /** An anti-dilution ratchet, quoted from the certificate; null for none (broad-based weighted average is not a ratchet). */
    ratchet: z
      .object({ text: z.string().trim().min(1) })
      .strict()
      .nullable(),
  })
  .strict()
  .refine(
    (series) => series.participating || series.participation_cap_multiple === null,
    "a cap needs a participating series",
  );

export const certificateSchema = z
  .object({
    schema_version: z.literal(CERTIFICATE_SCHEMA_VERSION),
    /** The watchlist slug. */
    issuer: z.string().regex(SLUG),
    /** The corporation's name as the certificate gives it. */
    legal_name: z.string().trim().min(1),
    /** The date the Division of Corporations stamps as filed. */
    filed_on: z.string().regex(ISO_DATE),
    /** The Division's file number for the corporation. */
    file_number: z.string().regex(/^\d{4,10}$/),
    kind: z.enum(["restated", "amendment"]),
    purchase: z
      .object({
        registry: z.string().trim().min(1),
        /** Where the certified copy was ordered. */
        url: z.string().regex(/^https:\/\//),
        bought_on: z.string().regex(ISO_DATE),
        /** SHA-256 of the PDF as received. */
        document_sha256: z.string().regex(SHA256),
      })
      .strict(),
    entered_by: z.string().trim().min(1),
    reviewed_by: z.string().trim().min(1).nullable(),
    /** The series this filing creates: its original issue price is the round's certificate price. */
    newest_series: z.string(),
    common_shares_authorized: decimal,
    series: z.array(seriesSchema).min(1),
    /** Terms the certificate carries that `CE_VERSION` does not model: `cumulative dividends`, `redemption`… */
    unmodelled_terms: z.array(z.string().trim().min(1)),
    notes: z.string().trim().min(1).nullable(),
  })
  .strict()
  .superRefine((certificate, context) => {
    const labels = certificate.series.map((series) => series.label);
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", message: "a series is listed twice" });
    }
    if (!labels.includes(certificate.newest_series)) {
      context.addIssue({ code: "custom", message: "newest_series must be one of the series" });
    }
  });

export type Certificate = z.infer<typeof certificateSchema>;

/** A transcription's text, validated; `path` (`<slug>/<filed_on>.json`) must agree with it. */
export function parseCertificate(text: string, path?: string): Certificate {
  const certificate = certificateSchema.parse(JSON.parse(text));
  if (path !== undefined) {
    const match = /([a-z0-9-]+)\/(\d{4}-\d{2}-\d{2})\.json$/.exec(path);
    if (match === null || match[1] !== certificate.issuer || match[2] !== certificate.filed_on) {
      throw new Error(
        `${path} must be at certificates/${certificate.issuer}/${certificate.filed_on}.json`,
      );
    }
  }
  return certificate;
}
