/**
 * How the index's figures are written on the pages. Every figure is the
 * API's; these only format it. Per-share marks keep cents (four decimals
 * below a dollar, where filers' marks live in fractions of a cent);
 * valuations and offering sizes are reported figures, written the short way.
 */

const USD_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USD_SMALL = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const COUNT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const SHARES = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

/** A per-share mark or price: $777.53, $0.4512. */
export function formatPerShare(value: number | string): string {
  const number = toNumber(value);
  return Math.abs(number) < 1 && number !== 0 ? USD_SMALL.format(number) : USD_CENTS.format(number);
}

/** A reported dollar amount, whole dollars: $86,950,760. */
export function formatDollars(value: number | string): string {
  return USD_WHOLE.format(toNumber(value));
}

/** A valuation or offering size the short way: $965B, $61B, $12.2M. */
export function formatValuation(value: number | string): string {
  const number = toNumber(value);
  const scaled = (divisor: number, suffix: string) => {
    const short = number / divisor;
    const digits = short >= 100 ? 0 : short >= 10 ? 1 : 2;
    return `$${Number(short.toFixed(digits)).toString()}${suffix}`;
  };
  if (Math.abs(number) >= 1e12) return scaled(1e12, "T");
  if (Math.abs(number) >= 1e9) return scaled(1e9, "B");
  if (Math.abs(number) >= 1e6) return scaled(1e6, "M");
  return formatDollars(number);
}

/** Dispersion and other percentages: 25.8%. A figure under 0.05% shows as <0.1%. */
export function formatPercent(value: number): string {
  if (value > 0 && value < 0.05) return "<0.1%";
  return `${value.toFixed(1)}%`;
}

/** A log difference as a percent change of the ratio: ln 0.2434 → +27.6%. */
export function formatLogChange(ln: number): string {
  const percent = (Math.exp(ln) - 1) * 100;
  return `${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(1)}%`;
}

export function formatCount(value: number | string): string {
  return COUNT.format(toNumber(value));
}

/** A balance as filed (shares or units), with its fractions. */
export function formatBalance(value: number | string): string {
  return SHARES.format(toNumber(value));
}

/** A plural noun with its count: 1 family, 5 families. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** An element id from a label: "Series F-1 Preferred" → "series-f-1-preferred". */
export function labelId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The anchor of one label's quarter on a name page. */
export function quarterId(label: string, quarter: string): string {
  return `${labelId(label)}-${quarter.toLowerCase()}`;
}

/** An instant as its UTC date and minute: 2026-11-05 12:00 UTC. */
export function formatInstant(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
