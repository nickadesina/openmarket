import type { Kysely, Transaction } from "kysely";

import { ServiceError } from "../api/errors.js";
import type { QuoteInput } from "../api/schemas.js";
import type { Database, MetricKind } from "../db/schema.js";
import { parseRequestedAmount, previewTrade } from "./preview-trade.js";

export interface QuoteResult {
  readonly market_id: string;
  readonly action: "buy" | "sell";
  readonly side: "yes" | "no";
  readonly strike_index: number;
  readonly strike_value: string | null;
  readonly metric_kind: MetricKind;
  readonly quantity: number;
  /** Positive for buys and negative for sells. */
  readonly engine_cost_usd: number;
  /** Conservative debit or proceeds magnitude, before any full-set redemption. */
  readonly cash_amount_cents: string;
  readonly price_before: number;
  /** Ledger cash magnitude per share, after cent quantization. */
  readonly average_price: number;
  readonly price_after: number;
  readonly current_metric_after: number;
  readonly expected_redemption_quantity: number;
  readonly expected_redemption_cents: string;
  readonly sellable_quantity: number;
  /** Diagnostic only. A quote does not reserve this state. */
  readonly market_state_fingerprint: string;
  readonly quoted_at: string;
}

async function quoteMarketFromSnapshot(
  db: Transaction<Database>,
  input: QuoteInput,
  userId?: string,
): Promise<QuoteResult> {
  const market = await db
    .selectFrom("companies")
    .innerJoin("markets", "markets.company_id", "companies.id")
    .select([
      "markets.id as market_id",
      "markets.n_buckets",
      "markets.bucket_grid_version",
      "markets.metric_kind",
      "markets.b",
      "markets.q",
      "markets.last_market_sequence",
    ])
    .where("companies.slug", "=", input.slug)
    .where("markets.status", "=", "open")
    .orderBy("markets.created_at", "desc")
    .executeTakeFirst();

  if (market === undefined) {
    const latestMarket = await db
      .selectFrom("companies")
      .innerJoin("markets", "markets.company_id", "companies.id")
      .select("markets.status")
      .where("companies.slug", "=", input.slug)
      .orderBy("markets.created_at", "desc")
      .executeTakeFirst();

    if (latestMarket?.status === "settled") {
      throw new ServiceError("MARKET_SETTLED", "This market has settled.");
    }
    throw new ServiceError("MARKET_NOT_FOUND", "Market not found.");
  }
  if (input.action === "sell" && userId === undefined) {
    throw new ServiceError("USER_REQUIRED", "A user is required to quote a sell.");
  }

  const amount = parseRequestedAmount(input);

  let holdings = new Array<number>(market.n_buckets).fill(0);
  if (userId !== undefined) {
    const holding = await db
      .selectFrom("holdings")
      .select("h")
      .where("user_id", "=", userId)
      .where("market_id", "=", market.market_id)
      .executeTakeFirst();
    if (holding !== undefined) {
      holdings = holding.h.slice();
    }
  }

  const preview = previewTrade(
    market,
    holdings,
    { action: input.action, side: input.side, strike_index: input.strike_index },
    amount,
  );

  return {
    market_id: market.market_id,
    action: input.action,
    side: input.side,
    strike_index: input.strike_index,
    strike_value: preview.strikeValue,
    metric_kind: market.metric_kind,
    quantity: preview.quantity,
    engine_cost_usd: preview.engineCostUsd,
    cash_amount_cents: String(preview.cashAmountCents),
    price_before: preview.priceBefore,
    average_price: Math.abs(preview.cashAmountCents) / 100 / preview.quantity,
    price_after: preview.priceAfter,
    current_metric_after: preview.metricAfter,
    expected_redemption_quantity: preview.redemptionQuantity,
    expected_redemption_cents: String(preview.redemptionCents),
    sellable_quantity: preview.sellableAfter,
    market_state_fingerprint: `${market.market_id}:${market.last_market_sequence}`,
    quoted_at: new Date().toISOString(),
  };
}

export async function quoteMarket(
  db: Kysely<Database>,
  input: QuoteInput,
  userId?: string,
): Promise<QuoteResult> {
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute((transaction) => quoteMarketFromSnapshot(transaction, input, userId));
}
