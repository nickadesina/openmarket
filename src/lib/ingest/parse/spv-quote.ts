/**
 * One capture of a public page quoting units of an SPV:
 * `data/index/spv-quotes/<issuer slug>/<captured_at date>-<platform>.json`
 * (data/index/spv-quotes/README.md). The page must be served without a login
 * and not disallowed by robots.txt (decision 0003 §4); the capture records
 * its URL, when it was taken and the SHA-256 of the page as served. Fees are
 * percentages (5 means 5 %), as the page states them; a fee the page does
 * not state is null.
 */
import { z } from "zod";

export const SPV_QUOTE_SCHEMA_VERSION = "0.1.0";
export const SPV_QUOTE_PARSER_VERSION = `spv-quote-${SPV_QUOTE_SCHEMA_VERSION}`;

const DECIMAL = /^\d+(?:\.\d+)?$/;
const positive = z
  .string()
  .regex(DECIMAL)
  .refine((value) => Number(value) > 0, "must be above zero");
const pct = z
  .string()
  .regex(DECIMAL)
  .refine((value) => Number(value) <= 100, "a percentage from 0 to 100");

export const spvQuoteSchema = z
  .object({
    schema_version: z.literal(SPV_QUOTE_SCHEMA_VERSION),
    issuer: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    platform: z.string().trim().min(1),
    url: z.string().regex(/^https:\/\//),
    /** ISO 8601 instant with a zone: `2026-11-05T14:03:00Z`. */
    captured_at: z.string().datetime({ offset: true }),
    /** SHA-256 of the page's HTML as served at capture. */
    page_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** That robots.txt allowed the page and no login was needed, checked at capture. */
    robots_allowed: z.literal(true),
    login_required: z.literal(false),
    /** The vehicle's CIK, when the page names a vehicle that files Form D. */
    vehicle_cik: z
      .string()
      .regex(/^[1-9]\d*$/)
      .nullable(),
    quoted_price_per_share_usd: positive.nullable(),
    quoted_valuation_usd: positive.nullable(),
    upfront_fee_pct: pct.nullable(),
    mgmt_fee_pct: pct.nullable(),
    carry_pct: pct.nullable(),
    /** Vehicles between the buyer and the share: 1 for a direct SPV. */
    layers: z.number().int().min(1),
    /** The page's words for the price, quoted. */
    quoted_text: z.string().trim().min(1),
    captured_by: z.string().trim().min(1),
  })
  .strict()
  .refine(
    (quote) => quote.quoted_price_per_share_usd !== null || quote.quoted_valuation_usd !== null,
    "a quote needs a price per share or a valuation",
  );

export type SpvQuote = z.infer<typeof spvQuoteSchema>;

export function parseSpvQuote(text: string): SpvQuote {
  return spvQuoteSchema.parse(JSON.parse(text));
}
