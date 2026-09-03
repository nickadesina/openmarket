import type { MarketDetail } from "../services/get-market.js";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const quantityFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});
const shortQuantityFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const probabilityFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const compactValuationFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
// Market prices carry four significant digits so adjacent levels stay
// distinguishable ($1.117T vs $1.152T); reported anchors and grid strikes
// keep the coarser compact form because those are the figures as published.
const priceValuationFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumSignificantDigits: 4,
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatUsd(value: number): string {
  return usdFormatter.format(value);
}

export function formatCents(value: string): string {
  const cents = Number(value);
  return Number.isFinite(cents) ? usdFormatter.format(cents / 100) : "Unavailable";
}

export function formatQuantity(value: number): string {
  return quantityFormatter.format(value);
}

/** Activity tapes round to cents-style precision; exact quantities stay in the ticket and portfolio. */
export function formatQuantityShort(value: number): string {
  return shortQuantityFormatter.format(value);
}

export function formatProbability(value: number): string {
  return probabilityFormatter.format(value);
}

/**
 * A contract price (average fill, price after) is a probability of a $1 payout and reads as
 * one, like the ladder; cash amounts (cost, proceeds, marked value) are the dollar figures.
 */
export function formatContractPrice(value: number): string {
  return probabilityFormatter.format(value);
}

export function formatValuation(value: number | string): string {
  const numericValue = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numericValue)) return "Unavailable";
  return compactValuationFormatter.format(numericValue);
}

export function formatMetric(value: number, kind: MarketDetail["metric"]["kind"]): string {
  return kind === "yes_probability" ? formatProbability(value) : formatValuation(value);
}

/** A traded valuation level: four significant digits. */
export function formatPrice(value: number | string): string {
  const numericValue = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numericValue)) return "Unavailable";
  return priceValuationFormatter.format(numericValue);
}

/** A traded metric level: probabilities as usual, valuations at price precision. */
export function formatMetricPrice(value: number, kind: MarketDetail["metric"]["kind"]): string {
  return kind === "yes_probability" ? formatProbability(value) : formatPrice(value);
}

export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

/** Calendar dates (anchor and settlement days) rendered in UTC so the day never shifts by timezone. */
export function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

export function movementGlyph(direction: "up" | "down" | "flat"): string {
  return direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
}

export function contractLabel(side: "yes" | "no", strikeLabel: string | null): string {
  const sideLabel = side.toUpperCase();
  if (strikeLabel === null) return sideLabel;
  return side === "yes"
    ? `${sideLabel} above ${strikeLabel}`
    : `${sideLabel} at or below ${strikeLabel}`;
}

export function strikeLabel(market: MarketDetail, strikeIndex: number): string {
  const contract = market.contracts.find((item) => item.strikeIndex === strikeIndex);
  if (market.metric.kind === "yes_probability") return "Outcome";
  return contract?.strikeValueUsd === null || contract === undefined
    ? "Unknown strike"
    : formatValuation(contract.strikeValueUsd);
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
