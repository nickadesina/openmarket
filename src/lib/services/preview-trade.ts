import { ServiceError } from "../api/errors.js";
import { parseUsdToCents } from "../api/money.js";
import type { ContractSide, MetricKind, TradeAction } from "../db/schema.js";
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
import { EPS, MAX_QUANTITY, MAX_TRADE_SPEND_CENTS, MIN_QUANTITY } from "../engine/types.js";

/** Structural view shared by the quote and trade request shapes. */
export interface TradeAmountInput {
  readonly action: TradeAction;
  readonly quantity?: number;
  readonly spend_usd?: string;
}

export interface RequestedAmount {
  readonly quantity: number | undefined;
  readonly spendCents: number | undefined;
}

export interface PreviewMarketState {
  readonly metric_kind: MetricKind;
  readonly bucket_grid_version: string;
  readonly n_buckets: number;
  readonly b: number;
  readonly q: readonly number[];
}

export interface TradePreviewRequest {
  readonly action: TradeAction;
  readonly side: ContractSide;
  readonly strike_index: number;
}

export interface TradePreview {
  readonly strikeValue: string | null;
  readonly mask: readonly boolean[];
  readonly quantity: number;
  readonly engineCostUsd: number;
  readonly cashAmountCents: number;
  readonly delta: number[];
  readonly qAfter: number[];
  readonly holdingsAfter: number[];
  readonly redemptionQuantity: number;
  readonly redemptionCents: number;
  readonly priceBefore: number;
  readonly priceAfter: number;
  readonly metricAfter: number;
  readonly sellableBefore: number;
  readonly sellableAfter: number;
}

function invalidInput(message: string): ServiceError {
  return new ServiceError("INVALID_INPUT", message);
}

/** Validates the quantity/spend choice once for both quoting and execution. */
export function parseRequestedAmount(input: TradeAmountInput): RequestedAmount {
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
    const quantity = input.quantity;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < MIN_QUANTITY) {
      throw invalidInput(`Quantity must be at least ${MIN_QUANTITY}.`);
    }
    if (quantity > MAX_QUANTITY) {
      throw invalidInput(`Quantity must be at most ${MAX_QUANTITY}.`);
    }
    return { quantity, spendCents: undefined };
  }

  const spendUsd = input.spend_usd;
  if (typeof spendUsd !== "string") {
    throw invalidInput("spend_usd must be a positive decimal-dollar string.");
  }

  try {
    const spendCents = parseUsdToCents(spendUsd);
    if (spendCents < 1 || spendCents > MAX_TRADE_SPEND_CENTS) {
      throw new RangeError("spend is outside the trade ceiling");
    }
    return { quantity: undefined, spendCents };
  } catch {
    throw invalidInput("spend_usd must be a positive decimal-dollar string.");
  }
}

function canonicalStrikeValue(market: PreviewMarketState, strikeIndex: number): string | null {
  if (!Number.isInteger(strikeIndex)) {
    throw invalidInput("Strike index must be an integer.");
  }

  if (market.metric_kind === "yes_probability") {
    if (market.n_buckets !== 2 || strikeIndex !== 0) {
      throw invalidInput("Binary markets use strike index 0.");
    }
    return null;
  }

  if (
    market.bucket_grid_version !== VALUATION_GRID_VERSION ||
    market.n_buckets !== VALUATION_BUCKET_COUNT ||
    strikeIndex < 0 ||
    strikeIndex >= VALUATION_BOUNDARIES_USD.length
  ) {
    throw invalidInput("Strike index is not valid for this valuation market.");
  }

  return VALUATION_BOUNDARIES_USD[strikeIndex]!.toFixed(2);
}

function assertFiniteVector(vector: readonly number[], expectedLength: number, name: string): void {
  if (vector.length !== expectedLength) {
    throw invalidInput(`${name} has an invalid length.`);
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw invalidInput(`${name} contains a non-finite value.`);
    }
  }
}

function sumMasked(values: readonly number[], mask: readonly boolean[]): number {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (mask[index]) total += values[index]!;
  }
  return total;
}

function metricAfterTrade(metricKind: MetricKind, distributionAfter: readonly number[]): number {
  if (metricKind === "valuation_median") {
    return impliedValuationMedian(distributionAfter, VALUATION_BOUNDARIES_USD);
  }
  const yesProbability = distributionAfter[1];
  if (yesProbability === undefined) {
    throw invalidInput("Binary market state is invalid.");
  }
  return yesProbability;
}

function insufficientHoldings(quantity: number, sellableBefore: number): ServiceError {
  return new ServiceError(
    "INSUFFICIENT_HOLDINGS",
    "The requested quantity exceeds the selected contract holdings.",
    { requested_quantity: quantity, sellable_quantity: sellableBefore },
  );
}

/**
 * The one pricing path for a trade against a known market/holdings snapshot.
 * Quoting and execution both consume this, so a quote can never price a
 * trade differently from the ledger write that follows it.
 */
export function previewTrade(
  market: PreviewMarketState,
  rawHoldings: readonly number[],
  request: TradePreviewRequest,
  amount: RequestedAmount,
): TradePreview {
  const strikeValue = canonicalStrikeValue(market, request.strike_index);
  assertFiniteVector(market.q, market.n_buckets, "Market state");
  assertFiniteVector(rawHoldings, market.n_buckets, "Holdings");
  const holdings = rawHoldings.map((value) => (Math.abs(value) < EPS ? 0 : value));
  if (holdings.some((value) => value < 0)) {
    throw invalidInput("Holdings state is invalid.");
  }

  try {
    const mask = contractMask(market.n_buckets, request.strike_index, request.side);

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
    if (quantity > MAX_QUANTITY) {
      throw invalidInput(`Quantity must be at most ${MAX_QUANTITY}.`);
    }

    const sellableBefore = sellableQuantity(holdings, mask);
    if (request.action === "sell" && quantity > sellableBefore + EPS) {
      throw insufficientHoldings(quantity, sellableBefore);
    }

    const delta = contractDelta(
      market.n_buckets,
      request.strike_index,
      request.side,
      request.action,
      quantity,
    );
    const engineCostUsd = spendCostUsd ?? tradeCost(market.q, delta, market.b);
    const cashAmountCents =
      spendCashAmountCents ??
      (request.action === "buy"
        ? quantizeBuyCostCents(engineCostUsd)
        : quantizeSellProceedsCents(engineCostUsd));
    if (!Number.isFinite(quantity) || quantity < MIN_QUANTITY || cashAmountCents === 0) {
      throw invalidInput("Trade produces no transferable quantity.");
    }

    const qAfter = market.q.map((value, index) => value + delta[index]!);
    assertFiniteVector(qAfter, market.n_buckets, "Updated market state");
    const holdingsAfterDelta = holdings.map((value, index) => {
      const next = value + delta[index]!;
      return Math.abs(next) < EPS ? 0 : next;
    });
    if (holdingsAfterDelta.some((value) => value < 0)) {
      throw insufficientHoldings(quantity, sellableBefore);
    }

    const minimumHolding = Math.min(...holdingsAfterDelta);
    const redemptionQuantity = minimumHolding > EPS ? minimumHolding : 0;
    const redemptionCents =
      redemptionQuantity === 0 ? 0 : quantizeEntitlementCents(redemptionQuantity);
    const holdingsAfter = holdingsAfterDelta.map((value) => {
      const redeemed = value - redemptionQuantity;
      return Math.abs(redeemed) < EPS ? 0 : redeemed;
    });

    const distributionBefore = probabilities(market.q, market.b);
    const distributionAfter = probabilities(qAfter, market.b);

    return {
      strikeValue,
      mask,
      quantity,
      engineCostUsd,
      cashAmountCents,
      delta,
      qAfter,
      holdingsAfter,
      redemptionQuantity,
      redemptionCents,
      priceBefore: sumMasked(distributionBefore, mask),
      priceAfter: sumMasked(distributionAfter, mask),
      metricAfter: metricAfterTrade(market.metric_kind, distributionAfter),
      sellableBefore,
      sellableAfter: sellableQuantity(holdingsAfter, mask),
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
