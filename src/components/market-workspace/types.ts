import type { ActivityPage } from "../../lib/services/get-activity.js";
import type { MarketDetail } from "../../lib/services/get-market.js";
import type { MarkHistory, MarkRange } from "../../lib/services/get-marks.js";
import type { ExecutionResult } from "../../lib/services/execute-trade.js";
import type { QuoteResult } from "../../lib/services/quote.js";

export type { ActivityPage, ExecutionResult, MarketDetail, MarkHistory, MarkRange, QuoteResult };

export type TradeAction = "buy" | "sell";
export type ContractSide = "yes" | "no";
export type BuyInputMode = "spend" | "quantity";

export interface TradeSelection {
  readonly strikeIndex: number;
  readonly side: ContractSide;
}

export function formatMetric(value: number, kind: MarketDetail["metric"]["kind"]): string {
  return kind === "yes_probability" ? formatProbability(value) : formatValuation(value);
}

export function formatProbability(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatValuation(value: number | string): string {
  const numericValue = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numericValue)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: numericValue >= 1_000_000_000 ? 1 : 0,
  }).format(numericValue);
}

export function formatUsdCents(value: string): string {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
  }).format(value);
}

export function strikeLabel(market: MarketDetail, strikeIndex: number): string {
  const contract = market.contracts.find((item) => item.strikeIndex === strikeIndex);
  if (market.metric.kind === "yes_probability") return "Outcome";
  return contract?.strikeValueUsd === null || contract === undefined
    ? "Unknown strike"
    : formatValuation(contract.strikeValueUsd);
}
