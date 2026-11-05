/**
 * SPV premium over the consensus mark: ln(quoted_pps × (1 + upfront_fee) /
 * consensus), with the fee-free (gross) premium beside it. Management fee,
 * carry and layer count are reported, not modelled.
 */
import { assertFinite, assertPositive } from "../assert.js";

/** One `spv_quotes` row. Fees are percentages: 5 means 5 %. */
export interface SpvQuoteInput {
  readonly quotedPricePerShareUsd: number | null;
  readonly upfrontFeePct: number | null;
  readonly mgmtFeePct: number | null;
  readonly carryPct: number | null;
  /** Vehicles between the buyer and the share: 1 for a direct SPV. */
  readonly layers: number;
}

export type SpvPremium =
  | {
      readonly status: "ok";
      /** ln(quoted × (1 + upfront fee) / consensus): what a buyer pays over the marks. Null when the fee is not stated. */
      readonly premiumLn: number | null;
      /** ln(quoted / consensus), fee-free. */
      readonly grossPremiumLn: number;
      readonly quotedPricePerShareUsd: number;
      readonly consensusUsd: number;
      readonly upfrontFeePct: number | null;
      readonly mgmtFeePct: number | null;
      readonly carryPct: number | null;
      readonly layers: number;
    }
  | {
      readonly status: "none";
      readonly reason: "no_per_share_quote";
    };

function assertPct(value: number | null, name: string): void {
  if (value === null) return;
  assertFinite(value, name);
  if (value < 0 || value > 100) throw new RangeError(`${name} must be a percentage from 0 to 100`);
}

export function spvPremium(quote: SpvQuoteInput, consensusUsd: number): SpvPremium {
  assertPositive(consensusUsd, "consensusUsd");
  assertPct(quote.upfrontFeePct, "upfrontFeePct");
  assertPct(quote.mgmtFeePct, "mgmtFeePct");
  assertPct(quote.carryPct, "carryPct");
  if (!Number.isInteger(quote.layers) || quote.layers < 1) {
    throw new RangeError("layers must be a whole number of at least one");
  }
  if (quote.quotedPricePerShareUsd === null)
    return { status: "none", reason: "no_per_share_quote" };
  assertPositive(quote.quotedPricePerShareUsd, "quotedPricePerShareUsd");

  const gross = Math.log(quote.quotedPricePerShareUsd / consensusUsd);
  const premium =
    quote.upfrontFeePct === null
      ? null
      : Math.log((quote.quotedPricePerShareUsd * (1 + quote.upfrontFeePct / 100)) / consensusUsd);
  return {
    status: "ok",
    premiumLn: premium,
    grossPremiumLn: gross,
    quotedPricePerShareUsd: quote.quotedPricePerShareUsd,
    consensusUsd,
    upfrontFeePct: quote.upfrontFeePct,
    mgmtFeePct: quote.mgmtFeePct,
    carryPct: quote.carryPct,
    layers: quote.layers,
  };
}
