import type { Kysely, Transaction } from "kysely";

import { ServiceError } from "../api/errors.js";
import { parseUsdToCents } from "../api/money.js";
import type { QuoteInput } from "../api/schemas.js";
import type { Database, MetricKind } from "../db/schema.js";
import {
  VALUATION_BOUNDARIES_USD,
  VALUATION_BUCKET_COUNT,
  VALUATION_GRID_VERSION,
} from "../engine/buckets.js";
import { contractDelta, contractMask, sellableQuantity } from "../engine/contracts.js";
import {
  probabilities,
  quantizeBuyCostCents,
  quantizeEntitlementCents,
  quantizeSellProceedsCents,
  solveBuyQuantityForSpend,
  tradeCost,
} from "../engine/lmsr.js";
import { impliedValuationMedian } from "../engine/median.js";
import { EPS, MIN_QUANTITY } from "../engine/types.js";

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

function invalidInput(message: string): ServiceError {
  return new ServiceError("INVALID_INPUT", message);
}

function selectedProbability(distribution: readonly number[], mask: readonly boolean[]): number {
  let total = 0;
  for (let index = 0; index < distribution.length; index += 1) {
    if (mask[index]) {
      total += distribution[index]!;
    }
  }
  return total;
}

function currentMetricAfter(metricKind: MetricKind, distribution: readonly number[]): number {
  if (metricKind === "valuation_median") {
    return impliedValuationMedian(distribution, VALUATION_BOUNDARIES_USD);
  }
  return distribution[1]!;
}

function canonicalStrikeValue(
  metricKind: MetricKind,
  bucketGridVersion: string,
  bucketCount: number,
  strikeIndex: number,
): string | null {
  if (!Number.isInteger(strikeIndex)) {
    throw invalidInput("Strike index must be an integer.");
  }

  if (metricKind === "yes_probability") {
    if (bucketCount !== 2 || strikeIndex !== 0) {
      throw invalidInput("Binary markets use strike index 0.");
    }
    return null;
  }

  if (
    bucketGridVersion !== VALUATION_GRID_VERSION ||
    bucketCount !== VALUATION_BUCKET_COUNT ||
    strikeIndex < 0 ||
    strikeIndex >= VALUATION_BOUNDARIES_USD.length
  ) {
    throw invalidInput("Strike index is not valid for this valuation market.");
  }

  return VALUATION_BOUNDARIES_USD[strikeIndex]!.toFixed(2);
}

function requestedAmount(input: QuoteInput): {
  quantity: number | undefined;
  spendCents: number | undefined;
} {
  const hasQuantity = Object.hasOwn(input, "quantity");
  const hasSpend = Object.hasOwn(input, "spend_usd");

  if (input.action === "buy") {
    if (hasQuantity === hasSpend) {
      throw invalidInput("A buy requires exactly one of quantity or spend_usd.");
    }
  } else if (!hasQuantity || hasSpend) {
    throw invalidInput("A sell requires quantity and does not accept spend_usd.");
  }

  if (hasQuantity) {
    const quantity = "quantity" in input ? input.quantity : undefined;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < MIN_QUANTITY) {
      throw invalidInput(`Quantity must be at least ${MIN_QUANTITY}.`);
    }
    return { quantity, spendCents: undefined };
  }

  const spendUsd = "spend_usd" in input ? input.spend_usd : undefined;
  if (typeof spendUsd !== "string") {
    throw invalidInput("spend_usd must be a positive decimal-dollar string.");
  }

  try {
    const spendCents = parseUsdToCents(spendUsd);
    if (spendCents < 1) {
      throw new RangeError("spend must be positive");
    }
    return { quantity: undefined, spendCents };
  } catch {
    throw invalidInput("spend_usd must be a positive decimal-dollar string.");
  }
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

  const amount = requestedAmount(input);

  const strikeValue = canonicalStrikeValue(
    market.metric_kind,
    market.bucket_grid_version,
    market.n_buckets,
    input.strike_index,
  );

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

  try {
    const mask = contractMask(market.n_buckets, input.strike_index, input.side);
    if (holdings.length !== market.n_buckets) {
      throw new RangeError("holding vector length does not match the market");
    }

    let quantity = amount.quantity;
    let spendCostUsd: number | undefined;
    let spendCashAmountCents: number | undefined;

    if (amount.spendCents !== undefined) {
      const solved = solveBuyQuantityForSpend(market.q, mask, market.b, amount.spendCents);
      quantity = solved.quantity;
      spendCostUsd = solved.costUsd;
      spendCashAmountCents = solved.cashAmountCents;
    }

    if (quantity === undefined) {
      throw new RangeError("quantity could not be determined");
    }

    const availableBefore = sellableQuantity(holdings, mask);
    if (input.action === "sell" && quantity > availableBefore + EPS) {
      throw new ServiceError(
        "INSUFFICIENT_HOLDINGS",
        "The requested quantity exceeds the selected contract holdings.",
        {
          requested_quantity: quantity,
          sellable_quantity: availableBefore,
        },
      );
    }

    const delta = contractDelta(
      market.n_buckets,
      input.strike_index,
      input.side,
      input.action,
      quantity,
    );
    const engineCostUsd = spendCostUsd ?? tradeCost(market.q, delta, market.b);
    const cashAmountCents =
      spendCashAmountCents ??
      (input.action === "buy"
        ? quantizeBuyCostCents(engineCostUsd)
        : quantizeSellProceedsCents(engineCostUsd));

    if (cashAmountCents === 0) {
      throw invalidInput("Trade produces no transferable quantity.");
    }

    const qAfter = market.q.map((value, index) => value + delta[index]!);
    const holdingsAfter = holdings.map((value, index) => {
      const next = value + delta[index]!;
      return Math.abs(next) < EPS ? 0 : next;
    });
    if (holdingsAfter.some((value) => value < 0)) {
      throw new ServiceError(
        "INSUFFICIENT_HOLDINGS",
        "The requested quantity exceeds the selected contract holdings.",
        {
          requested_quantity: quantity,
          sellable_quantity: availableBefore,
        },
      );
    }

    const minimumHolding = Math.min(...holdingsAfter);
    const expectedRedemptionQuantity = minimumHolding > EPS ? minimumHolding : 0;
    const holdingsAfterRedemption =
      expectedRedemptionQuantity === 0
        ? holdingsAfter
        : holdingsAfter.map((value) => value - expectedRedemptionQuantity);

    const distributionBefore = probabilities(market.q, market.b);
    const distributionAfter = probabilities(qAfter, market.b);

    return {
      market_id: market.market_id,
      action: input.action,
      side: input.side,
      strike_index: input.strike_index,
      strike_value: strikeValue,
      metric_kind: market.metric_kind,
      quantity,
      engine_cost_usd: engineCostUsd,
      cash_amount_cents: String(cashAmountCents),
      price_before: selectedProbability(distributionBefore, mask),
      average_price: Math.abs(engineCostUsd) / quantity,
      price_after: selectedProbability(distributionAfter, mask),
      current_metric_after: currentMetricAfter(market.metric_kind, distributionAfter),
      expected_redemption_quantity: expectedRedemptionQuantity,
      expected_redemption_cents: String(quantizeEntitlementCents(expectedRedemptionQuantity)),
      sellable_quantity: sellableQuantity(holdingsAfterRedemption, mask),
      market_state_fingerprint: `${market.market_id}:${market.last_market_sequence}`,
      quoted_at: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }
    if (error instanceof RangeError) {
      throw invalidInput(error.message);
    }
    throw error;
  }
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
