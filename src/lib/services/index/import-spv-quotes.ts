/**
 * `npm run index:spv-quotes`: each capture under data/index/spv-quotes/ into
 * `source_documents` (class `spv_quote_page`, the page's SHA-256 as content)
 * and `spv_quotes`, linked to the vehicle's latest Form D when the capture
 * names its CIK. Idempotent on (document, issuer). No scraper: a file is a
 * capture someone took of a real page.
 */
import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import { sourceRank } from "../../engine/rulebook.js";
import { SPV_QUOTE_PARSER_VERSION, type SpvQuote } from "../../ingest/parse/spv-quote.js";

export async function importSpvQuote(
  db: Kysely<Database>,
  quote: SpvQuote,
): Promise<"new" | "unchanged"> {
  return db.transaction().execute(async (trx) => {
    const issuer = await trx
      .selectFrom("issuers")
      .select("id")
      .where("slug", "=", quote.issuer)
      .executeTakeFirst();
    if (issuer === undefined) throw new Error(`no issuer ${quote.issuer}`);
    const capturedAt = new Date(quote.captured_at);
    await trx
      .insertInto("source_documents")
      .values({
        source_class: "spv_quote_page",
        source_rank: sourceRank("spv_quote_page"),
        accession: null,
        document_url: quote.url,
        filer_cik: null,
        filer_name: quote.platform,
        fund_series_id: null,
        fund_series_name: null,
        form_type: "unit quote page",
        filed_on: quote.captured_at.slice(0, 10),
        period_end: null,
        fetched_at: capturedAt,
        content_sha256: quote.page_sha256,
        parser_version: SPV_QUOTE_PARSER_VERSION,
      })
      .onConflict((conflict) => conflict.columns(["document_url", "content_sha256"]).doNothing())
      .execute();
    const document = await trx
      .selectFrom("source_documents")
      .select("id")
      .where("document_url", "=", quote.url)
      .where("content_sha256", "=", quote.page_sha256)
      .executeTakeFirstOrThrow();
    const vehicle =
      quote.vehicle_cik === null
        ? undefined
        : await trx
            .selectFrom("spv_vehicles")
            .innerJoin("source_documents", "source_documents.id", "spv_vehicles.document_id")
            .select("spv_vehicles.id")
            .where("spv_vehicles.vehicle_cik", "=", quote.vehicle_cik)
            .orderBy("source_documents.filed_on", "desc")
            .executeTakeFirst();
    const inserted = await trx
      .insertInto("spv_quotes")
      .values({
        issuer_id: issuer.id,
        spv_vehicle_id: vehicle?.id ?? null,
        document_id: document.id,
        platform: quote.platform,
        quoted_price_per_share_usd: quote.quoted_price_per_share_usd,
        quoted_valuation_usd: quote.quoted_valuation_usd,
        upfront_fee_pct: quote.upfront_fee_pct,
        mgmt_fee_pct: quote.mgmt_fee_pct,
        carry_pct: quote.carry_pct,
        layers: quote.layers,
        captured_at: capturedAt,
      })
      .onConflict((conflict) => conflict.columns(["document_id", "issuer_id"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    return inserted === undefined ? "unchanged" : "new";
  });
}
