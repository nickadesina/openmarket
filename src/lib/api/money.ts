export const USD_MAX_LENGTH = 18;

const USD_PATTERN = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?(?![\s\S])/;

/** Converts a canonical decimal-dollar string to an exact, safe integer cent value. */
export function parseUsdToCents(usd: string): number {
  if (typeof usd !== "string" || usd.length > USD_MAX_LENGTH) {
    throw new RangeError(
      `USD must be a string of at most ${USD_MAX_LENGTH} characters`,
    );
  }

  const match = USD_PATTERN.exec(usd);
  if (match === null) {
    throw new RangeError(
      "USD must be a canonical decimal string with at most two fractional digits",
    );
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const dollars = BigInt(match[2]!);
  const fractional = match[3] ?? "";
  const cents = BigInt(fractional.padEnd(2, "0"));
  const value = sign * (dollars * 100n + cents);

  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RangeError("USD cent value exceeds JavaScript's safe integer range");
  }

  return Number(value);
}

/** Formats an integer cent value without passing currency through Float64 division. */
export function formatCentsAsUsd(cents: number | bigint): string {
  if (typeof cents === "number") {
    if (!Number.isSafeInteger(cents)) {
      throw new RangeError("cents must be a safe integer");
    }
  }

  const value = BigInt(cents);
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  const dollars = magnitude / 100n;
  const fractional = (magnitude % 100n).toString().padStart(2, "0");

  return `${sign}${dollars}.${fractional}`;
}
