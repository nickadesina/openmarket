/**
 * The common-equivalent conversion (`CE_VERSION`): a liquidation waterfall
 * over a certificate's preferred series, evaluated at the headline
 * post-money, and the structure gap between the headline and what common
 * would be worth there.
 *
 * Modelled: seniority (1 = most senior; equal ranks are pari passu, pro rata
 * by preference), a liquidation multiple on original issue price,
 * participating preferred with or without a cap (the cap is total proceeds as
 * a multiple of original issue price), non-participating preferred that
 * converts to common when converting pays more, and a conversion price other
 * than the issue price. Not modelled, and so `unsupported`: a ratchet, or any
 * term the transcription lists in `unmodelledTerms` (cumulative dividends,
 * pay-to-play, redemption…). Preferred share counts are shares authorized,
 * an upper bound on the preference stack (`basis: "authorized"`).
 */
import { assertFinite, assertNonNegative, assertPositive } from "../assert.js";
import { assertNonEmptyString, compareText } from "./mark.js";

export const CE_VERSION = "0.1.0";
export const CE_BASIS = "authorized";

/** One `certificate_series` row. */
export interface CertificateSeriesInput {
  readonly seriesLabel: string;
  readonly originalIssuePriceUsd: number;
  readonly liquidationMultiple: number;
  readonly participating: boolean;
  /** Total proceeds cap as a multiple of original issue price; null for none. Participating only. */
  readonly participationCapMultiple: number | null;
  /** 1 = most senior; equal values rank pari passu. */
  readonly seniority: number;
  readonly sharesAuthorized: number;
  /** Null when it equals the original issue price (one common share per preferred share). */
  readonly conversionPriceUsd: number | null;
  /** `certificate_series.ratchet`; anything but null is unsupported. */
  readonly ratchet: unknown;
}

export interface CertificateInput {
  readonly series: readonly CertificateSeriesInput[];
  /** Terms the certificate carries that this function does not model; any entry makes it unsupported. */
  readonly unmodelledTerms?: readonly string[];
}

export interface Unsupported {
  readonly status: "unsupported";
  readonly ceVersion: typeof CE_VERSION;
  readonly reason: string;
}

export interface SeriesPayout {
  readonly seriesLabel: string;
  readonly shares: number;
  readonly asConvertedShares: number;
  readonly converts: boolean;
  readonly preferenceUsd: number;
  readonly participationUsd: number;
  readonly totalUsd: number;
  readonly perShareUsd: number;
}

export interface Waterfall {
  readonly status: "ok";
  readonly ceVersion: typeof CE_VERSION;
  readonly equityValueUsd: number;
  readonly commonShares: number;
  readonly commonPerShareUsd: number;
  readonly commonTotalUsd: number;
  readonly series: readonly SeriesPayout[];
}

export interface CommonEquivalent {
  readonly status: "ok";
  readonly ceVersion: typeof CE_VERSION;
  readonly basis: typeof CE_BASIS;
  readonly headlinePostMoneyUsd: number;
  readonly pricePerShareUsd: number;
  /** headline / price per share. */
  readonly fullyDilutedShares: number;
  /** Fully diluted shares less the preferred, as converted. */
  readonly commonShares: number;
  readonly commonPerShareUsd: number;
  /** Common's per-share payout at the headline × fully diluted shares. */
  readonly commonEquivalentUsd: number;
  readonly waterfall: Waterfall;
}

export interface StructureGap {
  readonly status: "ok";
  readonly ceVersion: typeof CE_VERSION;
  readonly basis: typeof CE_BASIS;
  /** ln(headline / common equivalent). */
  readonly gapLn: number;
  readonly headlinePostMoneyUsd: number;
  readonly commonEquivalentUsd: number;
  readonly commonPerShareUsd: number;
  readonly pricePerShareUsd: number;
}

interface Series {
  readonly label: string;
  readonly shares: number;
  readonly asConverted: number;
  readonly preference: number;
  readonly participating: boolean;
  readonly capTotal: number | null;
  readonly seniority: number;
  /** Value per as-converted share above which converting pays: a non-participating or capped series. */
  readonly threshold: number | null;
}

interface Payouts {
  readonly preference: readonly number[];
  readonly participation: readonly number[];
  readonly commonPerShare: number;
}

function unsupported(reason: string): Unsupported {
  return { status: "unsupported", ceVersion: CE_VERSION, reason };
}

function validateSeries(input: CertificateSeriesInput): void {
  assertNonEmptyString(input.seriesLabel, "seriesLabel");
  assertPositive(input.originalIssuePriceUsd, "originalIssuePriceUsd");
  assertNonNegative(input.liquidationMultiple, "liquidationMultiple");
  assertPositive(input.sharesAuthorized, "sharesAuthorized");
  if (typeof input.participating !== "boolean")
    throw new TypeError("participating must be a boolean");
  if (!Number.isInteger(input.seniority) || input.seniority < 1) {
    throw new RangeError("seniority must be a whole number of at least one");
  }
  if (input.conversionPriceUsd !== null)
    assertPositive(input.conversionPriceUsd, "conversionPriceUsd");
  const cap = input.participationCapMultiple;
  if (cap === null) return;
  assertFinite(cap, "participationCapMultiple");
  if (!input.participating)
    throw new RangeError("a participation cap applies only to participating preferred");
  if (cap < input.liquidationMultiple) {
    throw new RangeError(
      "a participation cap is total proceeds and must be at least the liquidation multiple",
    );
  }
}

function toSeries(input: CertificateSeriesInput): Series {
  const conversionPrice = input.conversionPriceUsd ?? input.originalIssuePriceUsd;
  const asConverted = (input.sharesAuthorized * input.originalIssuePriceUsd) / conversionPrice;
  const preference =
    input.liquidationMultiple * input.originalIssuePriceUsd * input.sharesAuthorized;
  const capTotal =
    input.participationCapMultiple === null
      ? null
      : input.participationCapMultiple * input.originalIssuePriceUsd * input.sharesAuthorized;
  const decides = !input.participating || capTotal !== null;
  return {
    label: input.seriesLabel,
    shares: input.sharesAuthorized,
    asConverted,
    preference,
    participating: input.participating,
    capTotal,
    seniority: input.seniority,
    threshold: decides ? (capTotal ?? preference) / asConverted : null,
  };
}

/** The certificate's series, or why the function cannot evaluate it. */
function prepare(certificate: CertificateInput): Series[] | Unsupported {
  if (!Array.isArray(certificate.series) || certificate.series.length === 0) {
    throw new RangeError("a certificate needs at least one series");
  }
  const labels = new Set<string>();
  for (const input of certificate.series) {
    validateSeries(input);
    if (labels.has(input.seriesLabel))
      throw new RangeError(`series ${input.seriesLabel} is listed twice`);
    labels.add(input.seriesLabel);
  }
  const terms = certificate.unmodelledTerms ?? [];
  if (terms.length > 0)
    return unsupported(`terms not modelled: ${[...terms].sort(compareText).join(", ")}`);
  const ratcheted = certificate.series.filter(
    (input) => input.ratchet !== null && input.ratchet !== undefined,
  );
  if (ratcheted.length > 0) {
    return unsupported(`ratchet on ${ratcheted.map((input) => input.seriesLabel).join(", ")}`);
  }
  return certificate.series.map(toSeries);
}

/** Pays preferences by seniority, pro rata by claim within a rank; returns what is left. */
function payPreferences(
  series: readonly Series[],
  converts: readonly boolean[],
  value: number,
  paid: number[],
): number {
  let remaining = value;
  const ranks = [...new Set(series.map((item) => item.seniority))].sort(
    (left, right) => left - right,
  );
  for (const rank of ranks) {
    const members = series.flatMap((item, index) =>
      item.seniority === rank && !converts[index] ? [index] : [],
    );
    const claim = members.reduce((sum, index) => sum + series[index]!.preference, 0);
    if (claim === 0) continue;
    const share = Math.min(1, remaining / claim);
    for (const index of members) paid[index] = series[index]!.preference * share;
    remaining = Math.max(0, remaining - claim * share);
  }
  return remaining;
}

interface Participant {
  readonly index: number | null;
  readonly shares: number;
  readonly room: number;
}

/** Shares the residual pro rata by as-converted shares, capping participants at their room. */
function shareResidual(
  participants: readonly Participant[],
  residual: number,
): { rate: number; capped: Map<number, number> } {
  const capped = new Map<number, number>();
  let active = [...participants];
  let remaining = residual;
  for (;;) {
    const shares = active.reduce((sum, item) => sum + item.shares, 0);
    const rate = remaining / shares;
    const binding = active.filter((item) => item.index !== null && item.room < rate * item.shares);
    if (binding.length === 0) return { rate, capped };
    for (const item of binding) {
      capped.set(item.index!, item.room);
      remaining -= item.room;
    }
    active = active.filter((item) => !binding.includes(item));
  }
}

function payouts(
  series: readonly Series[],
  converts: readonly boolean[],
  commonShares: number,
  value: number,
): Payouts {
  const preference = series.map(() => 0);
  const residual = payPreferences(series, converts, value, preference);
  const participants: Participant[] = [
    { index: null, shares: commonShares, room: Number.POSITIVE_INFINITY },
  ];
  series.forEach((item, index) => {
    if (converts[index]) {
      participants.push({ index, shares: item.asConverted, room: Number.POSITIVE_INFINITY });
    } else if (item.participating) {
      const room =
        item.capTotal === null
          ? Number.POSITIVE_INFINITY
          : Math.max(0, item.capTotal - preference[index]!);
      participants.push({ index, shares: item.asConverted, room });
    }
  });
  const { rate, capped } = shareResidual(participants, residual);
  const participation = series.map((item, index) => {
    if (capped.has(index)) return capped.get(index)!;
    return converts[index] || item.participating ? rate * item.asConverted : 0;
  });
  return { preference, participation, commonPerShare: rate };
}

function total(result: Payouts, index: number): number {
  return result.preference[index]! + result.participation[index]!;
}

/** No series would do better by flipping its own conversion choice. */
function isStable(
  series: readonly Series[],
  converts: readonly boolean[],
  commonShares: number,
  value: number,
): boolean {
  const current = payouts(series, converts, commonShares, value);
  const tolerance = 1e-12 * Math.max(1, value);
  return series.every((item, index) => {
    if (item.threshold === null) return true;
    const flipped = converts.map((choice, other) => (other === index ? !choice : choice));
    return (
      total(current, index) + tolerance >=
      total(payouts(series, flipped, commonShares, value), index)
    );
  });
}

/** Series convert in order of their threshold; the first stable prefix is the outcome. */
function conversionChoice(
  series: readonly Series[],
  commonShares: number,
  value: number,
): boolean[] | null {
  const order = series
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.threshold !== null)
    .sort(
      (left, right) =>
        left.item.threshold! - right.item.threshold! ||
        left.item.seniority - right.item.seniority ||
        compareText(left.item.label, right.item.label),
    );
  for (let count = 0; count <= order.length; count += 1) {
    const converts = series.map(() => false);
    for (const { index } of order.slice(0, count)) converts[index] = true;
    if (isStable(series, converts, commonShares, value)) return converts;
  }
  return null;
}

/**
 * The waterfall at equity value `equityValueUsd` with `commonShares` common
 * shares outstanding beside the certificate's preferred. Pays out exactly the
 * equity value (to floating point).
 */
export function liquidationWaterfall(
  certificate: CertificateInput,
  commonShares: number,
  equityValueUsd: number,
): Waterfall | Unsupported {
  const prepared = prepare(certificate);
  if (!Array.isArray(prepared)) return prepared;
  assertPositive(commonShares, "commonShares");
  assertNonNegative(equityValueUsd, "equityValueUsd");

  const converts = conversionChoice(prepared, commonShares, equityValueUsd);
  if (converts === null) return unsupported("no stable conversion choice at this equity value");
  const result = payouts(prepared, converts, commonShares, equityValueUsd);
  return {
    status: "ok",
    ceVersion: CE_VERSION,
    equityValueUsd,
    commonShares,
    commonPerShareUsd: result.commonPerShare,
    commonTotalUsd: result.commonPerShare * commonShares,
    series: prepared.map((item, index) => ({
      seriesLabel: item.label,
      shares: item.shares,
      asConvertedShares: item.asConverted,
      converts: converts[index]!,
      preferenceUsd: result.preference[index]!,
      participationUsd: result.participation[index]!,
      totalUsd: total(result, index),
      perShareUsd: total(result, index) / item.shares,
    })),
  };
}

/**
 * Common's value at the headline: the waterfall at the headline post-money,
 * with fully diluted shares `headline / pps` and common the fully diluted
 * shares less the preferred as converted; the common-equivalent value is
 * common's per-share payout times fully diluted shares.
 */
export function commonEquivalent(
  certificate: CertificateInput,
  headlinePostMoneyUsd: number,
  pricePerShareUsd: number,
): CommonEquivalent | Unsupported {
  assertPositive(headlinePostMoneyUsd, "headlinePostMoneyUsd");
  assertPositive(pricePerShareUsd, "pricePerShareUsd");
  const prepared = prepare(certificate);
  if (!Array.isArray(prepared)) return prepared;

  const fullyDiluted = headlinePostMoneyUsd / pricePerShareUsd;
  const preferredAsConverted = prepared.reduce((sum, item) => sum + item.asConverted, 0);
  const commonShares = fullyDiluted - preferredAsConverted;
  if (!(commonShares > fullyDiluted * 1e-12)) {
    return unsupported(
      "preferred shares authorized, as converted, are at least the fully diluted shares the headline implies",
    );
  }
  const waterfall = liquidationWaterfall(certificate, commonShares, headlinePostMoneyUsd);
  if (waterfall.status === "unsupported") return waterfall;
  return {
    status: "ok",
    ceVersion: CE_VERSION,
    basis: CE_BASIS,
    headlinePostMoneyUsd,
    pricePerShareUsd,
    fullyDilutedShares: fullyDiluted,
    commonShares,
    commonPerShareUsd: waterfall.commonPerShareUsd,
    commonEquivalentUsd: waterfall.commonPerShareUsd * fullyDiluted,
    waterfall,
  };
}

/** ln(headline / common equivalent): how much of the headline the preference stack accounts for. */
export function structureGap(
  certificate: CertificateInput,
  headlinePostMoneyUsd: number,
  pricePerShareUsd: number,
): StructureGap | Unsupported {
  const result = commonEquivalent(certificate, headlinePostMoneyUsd, pricePerShareUsd);
  if (result.status === "unsupported") return result;
  if (!(result.commonEquivalentUsd > 0))
    return unsupported("common receives nothing at the headline");
  return {
    status: "ok",
    ceVersion: CE_VERSION,
    basis: CE_BASIS,
    gapLn: Math.log(headlinePostMoneyUsd / result.commonEquivalentUsd),
    headlinePostMoneyUsd,
    commonEquivalentUsd: result.commonEquivalentUsd,
    commonPerShareUsd: result.commonPerShareUsd,
    pricePerShareUsd,
  };
}
