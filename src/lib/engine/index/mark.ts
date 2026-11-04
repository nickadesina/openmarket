/**
 * The unit of the index (decision 0003 §3): one per-share mark on one
 * security, from one filer, as of one date. Shared arithmetic for the derived
 * series: the per-share rule, calendar dates, quarters and the median.
 */
import { assertFinite } from "../assert.js";

/** A calendar date of record, `YYYY-MM-DD`; never an instant. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** N-PORT's `units` code for a holding counted in shares. */
export const SHARE_UNITS = "NS";

function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function assertIsoDate(value: string, name: string): void {
  if (typeof value !== "string" || parseIsoDate(value) === null) {
    throw new RangeError(`${name} must be a calendar date written YYYY-MM-DD`);
  }
}

export function assertNonEmptyString(value: string, name: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RangeError(`${name} must be a non-empty string`);
  }
}

/** Days since 1970-01-01 for a calendar date. */
export function dayNumber(value: IsoDate): number {
  const parts = parseIsoDate(value);
  if (parts === null) throw new RangeError("date must be a calendar date written YYYY-MM-DD");
  return Date.UTC(parts.year, parts.month - 1, parts.day) / MS_PER_DAY;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}

/** The calendar quarter a date falls in, written `2026Q3`. */
export function calendarQuarter(value: IsoDate): string {
  const parts = parseIsoDate(value);
  if (parts === null) throw new RangeError("date must be a calendar date written YYYY-MM-DD");
  return `${parts.year}Q${Math.floor((parts.month - 1) / 3) + 1}`;
}

/** First and last day of a quarter written `2026Q3`. */
export function quarterBounds(quarter: string): { start: IsoDate; end: IsoDate } {
  const match = /^(\d{4})Q([1-4])$/.exec(quarter);
  if (match === null) throw new RangeError("quarter must be written like 2026Q3");
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, index * 3, 1));
  const end = new Date(Date.UTC(year, index * 3 + 3, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * The median of finite values: the middle one, or the mean of the two middle
 * ones for an even count. Never reorders the caller's array.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median needs at least one value");
  for (const value of values) assertFinite(value, "value");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export interface HoldingAmounts {
  /** N-PORT `valUSD`: the holding's fair value in USD. */
  readonly valueUsd: number;
  /** N-PORT `balance`; null when the filing left it blank. */
  readonly balance: number | null;
  /** N-PORT `units` (`NS` shares, `PA` principal, `NC` contracts, `OU` other units…). */
  readonly units: string | null;
}

/**
 * The per-share mark: `value_usd / balance` when the holding is counted in
 * shares (`units = NS`) and the balance is positive; otherwise null, and the
 * row counts toward value but not toward per-share series. A negative value
 * (a short) has no per-share mark.
 */
export function perShareMark(holding: HoldingAmounts): number | null {
  assertFinite(holding.valueUsd, "valueUsd");
  if (holding.balance !== null) assertFinite(holding.balance, "balance");
  if (holding.units !== SHARE_UNITS) return null;
  if (holding.balance === null || holding.balance <= 0) return null;
  if (holding.valueUsd < 0) return null;
  return holding.valueUsd / holding.balance;
}

/** ln(numerator / denominator) for positive finite values. */
export function lnRatio(numerator: number, denominator: number): number {
  assertFinite(numerator, "numerator");
  assertFinite(denominator, "denominator");
  if (numerator <= 0 || denominator <= 0) {
    throw new RangeError("a log ratio needs two positive values");
  }
  return Math.log(numerator / denominator);
}

/** Stable string comparison for deterministic output order. */
export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
