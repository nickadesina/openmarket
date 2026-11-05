/**
 * Mark versus last print: ln(mark / print_pps), where the print is the
 * latest round announced on or before the mark's date whose certificate
 * gives a per-share price, for the newest series or for the mark's own
 * label. Null, with the reason, without a certificate price.
 */
import { assertNonNegative, assertPositive } from "../assert.js";
import { assertIsoDate, assertNonEmptyString, compareText, type IsoDate } from "./mark.js";

/** One `prints` row. */
export interface PrintInput {
  /** `prints.id`. */
  readonly id: string;
  readonly roundName: string;
  readonly announcedOn: IsoDate;
  /** From the certificate that prices the round; null until one is imported. */
  readonly seriesLabel: string | null;
  /** From the certificate (original issue price); null until one is imported. */
  readonly pricePerShareUsd: number | null;
}

export interface MarkForPrint {
  readonly securityLabel: string;
  readonly asOf: IsoDate;
  readonly markPerShareUsd: number;
}

export type MarkVersusPrint =
  | {
      readonly status: "ok";
      readonly ln: number;
      readonly printId: string;
      readonly roundName: string;
      readonly announcedOn: IsoDate;
      readonly seriesLabel: string | null;
      readonly pricePerShareUsd: number;
      /** `newest_series`: the latest round; `same_label`: the mark's own series, the newest being unpriced. */
      readonly match: "newest_series" | "same_label";
    }
  | {
      readonly status: "none";
      readonly ln: null;
      readonly reason: "no_print_on_or_before_mark" | "no_certificate_price" | "zero_mark";
    };

function validatePrint(print: PrintInput): void {
  assertNonEmptyString(print.id, "id");
  assertNonEmptyString(print.roundName, "roundName");
  assertIsoDate(print.announcedOn, "announcedOn");
  if (print.seriesLabel !== null) assertNonEmptyString(print.seriesLabel, "seriesLabel");
  if (print.pricePerShareUsd !== null) assertPositive(print.pricePerShareUsd, "pricePerShareUsd");
}

function isPriced(print: PrintInput): print is PrintInput & { pricePerShareUsd: number } {
  return print.pricePerShareUsd !== null;
}

/** Newest first; on one day a priced print before an unpriced one, then by id. */
function newestFirst(left: PrintInput, right: PrintInput): number {
  return (
    compareText(right.announcedOn, left.announcedOn) ||
    Number(isPriced(right)) - Number(isPriced(left)) ||
    compareText(left.id, right.id)
  );
}

/**
 * Compares one mark (a family's, or a consensus) with the issuer's prints.
 * The newest round on or before the mark's date is used when its
 * certificate gives a per-share price; otherwise the latest priced print for
 * the mark's own label; otherwise none.
 */
export function markVersusPrint(
  mark: MarkForPrint,
  prints: readonly PrintInput[],
): MarkVersusPrint {
  assertNonEmptyString(mark.securityLabel, "securityLabel");
  assertIsoDate(mark.asOf, "asOf");
  assertNonNegative(mark.markPerShareUsd, "markPerShareUsd");
  for (const print of prints) validatePrint(print);

  const eligible = prints.filter((print) => print.announcedOn <= mark.asOf).sort(newestFirst);
  const newest = eligible[0];
  if (newest === undefined)
    return { status: "none", ln: null, reason: "no_print_on_or_before_mark" };

  const sameLabel = eligible.find(
    (print) => isPriced(print) && print.seriesLabel === mark.securityLabel,
  );
  const chosen = isPriced(newest) ? newest : sameLabel;
  if (chosen === undefined || !isPriced(chosen)) {
    return { status: "none", ln: null, reason: "no_certificate_price" };
  }
  if (mark.markPerShareUsd === 0) return { status: "none", ln: null, reason: "zero_mark" };
  return {
    status: "ok",
    ln: Math.log(mark.markPerShareUsd / chosen.pricePerShareUsd),
    printId: chosen.id,
    roundName: chosen.roundName,
    announcedOn: chosen.announcedOn,
    seriesLabel: chosen.seriesLabel,
    pricePerShareUsd: chosen.pricePerShareUsd,
    match:
      chosen === newest && chosen.seriesLabel !== mark.securityLabel
        ? "newest_series"
        : "same_label",
  };
}
