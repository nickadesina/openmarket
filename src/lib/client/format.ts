import type { ContractSide, ListingTier, MetricKind } from "../db/schema.js";

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
  // Explicit, or Node's ICU pads small values ($0.0) where browsers print $0 and hydration fails.
  minimumFractionDigits: 0,
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

/** Cash at board density ($48.3K); open interest and other dollar totals in strips and tables. */
export function formatCompactUsd(value: number): string {
  return Number.isFinite(value) ? compactValuationFormatter.format(value) : "Unavailable";
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

/** A relative change magnitude (0.157 → "15.7%"); direction is carried by an arrow and a word. */
export function formatPercent(value: number): string {
  return probabilityFormatter.format(value);
}

/** The level against the last public round, from the API's ratio − 1; never empty, unlike a quiet day's change. */
export function roundChange(change: number | null): {
  readonly direction: "up" | "down" | "flat";
  readonly label: string;
} {
  if (change === null || !Number.isFinite(change) || change === 0) {
    return { direction: "flat", label: "Level" };
  }
  return {
    direction: change > 0 ? "up" : "down",
    label: `${change > 0 ? "Up" : "Down"} ${formatPercent(Math.abs(change))}`,
  };
}

export function formatValuation(value: number | string): string {
  const numericValue = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numericValue)) return "Unavailable";
  return compactValuationFormatter.format(numericValue);
}

/** A traded valuation level: four significant digits. */
export function formatPrice(value: number | string): string {
  const numericValue = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numericValue)) return "Unavailable";
  return priceValuationFormatter.format(numericValue);
}

/** A book's level: a binary's YES probability, a forward's mid at price precision. */
export function formatMetricPrice(value: number, kind: MetricKind): string {
  return kind === "yes_probability" ? formatProbability(value) : formatPrice(value);
}

export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

/** Calendar dates (anchor and settlement days) rendered in UTC so the day never shifts by timezone. */
export function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

/** A contract side as the tape and the ticket name it: YES, NO, LONG, SHORT. */
export function sideLabel(side: ContractSide): string {
  return side.toUpperCase();
}

/** The tier as published (README D10): mega-cap from a $10B print, red-hot below. */
export function tierLabel(tier: ListingTier): string {
  return tier === "mega" ? "Mega-cap" : "Red-hot";
}

/** A model or rulebook version as stamped on a published price. */
export function formatVersion(version: string): string {
  return `v${version}`;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Tournament dates are stated in the tournament's home zone, with the zone shown. */
const tournamentDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
  timeZoneName: "short",
});
const tournamentMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const tournamentValueFormatter = new Intl.NumberFormat("en-US", {
  maximumSignificantDigits: 4,
});
const scoreFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const wholePercentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});
const multipleFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export type TournamentUnitLabel = "USD_B" | "USD_T" | "bool";

/** A ladder value in its question's unit: $74.2B, $1.25T. */
export function formatTournamentValue(value: number, unit: TournamentUnitLabel): string {
  if (!Number.isFinite(value)) return "Unavailable";
  if (unit === "bool") return formatProbability(value);
  return `$${tournamentValueFormatter.format(value)}${unit === "USD_T" ? "T" : "B"}`;
}

/** A median that falls in an open-ended end bucket reads as a bound, never a point. */
export function formatTournamentMedian(
  value: number,
  position: "within" | "below" | "above" | null,
  unit: TournamentUnitLabel,
): string {
  const formatted = formatTournamentValue(value, unit);
  if (position === "below") return `<${formatted}`;
  if (position === "above") return `>${formatted}`;
  return formatted;
}

export function tournamentUnitCaption(unit: TournamentUnitLabel): string {
  if (unit === "USD_B") return "USD billions";
  if (unit === "USD_T") return "USD trillions";
  return "Yes or no";
}

export function formatTournamentDateTime(value: string): string {
  return tournamentDateTimeFormatter.format(new Date(value));
}

/** A leaderboard period: "all" or "YYYY-MM". */
export function formatTournamentPeriod(period: string): string {
  if (period === "all") return "All time";
  return tournamentMonthFormatter.format(new Date(`${period}-01T00:00:00Z`));
}

/** Baseline-relative log score: 0 is uniform, 100 is certain and right. */
export function formatScore(value: number): string {
  return scoreFormatter.format(value);
}

/** Share of a window with a forecast on file; a sliver never rounds down to 0%. */
export function formatCoverage(value: number): string {
  if (value > 0 && value < 0.01) return "<1%";
  return wholePercentFormatter.format(value);
}

export function formatMultiple(value: number): string {
  return `${multipleFormatter.format(value)}×`;
}

/** Coarse time remaining; callers render it after mount so server and client agree. */
export function formatTimeUntil(target: string, now: number): string {
  const remaining = new Date(target).getTime() - now;
  if (remaining <= 0) return "closed";
  const minutes = Math.floor(remaining / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.floor(hours / 24)} days`;
}

/** "@handle" for an X account; a password account's username carries no "@", so it never reads as one. */
export function formatForecasterName(identity: {
  readonly handle: string;
  readonly provider: "x" | "dev" | "password";
}): string {
  return identity.provider === "password" ? identity.handle : `@${identity.handle}`;
}

/** A job's run time: milliseconds under a second, seconds under a minute, then minutes. */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Unavailable";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  return `${(milliseconds / 60_000).toFixed(1)} min`;
}

/** Elapsed hours at one decimal ("74.5 h"): how long an instrument has been widened. */
export function formatHours(hours: number): string {
  return Number.isFinite(hours) ? `${hours.toFixed(1)} h` : "Unavailable";
}
