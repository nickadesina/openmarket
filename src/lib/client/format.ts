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
export const formatContractPrice = formatProbability;

/** A relative change magnitude (0.157 → "15.7%"); direction is carried by an arrow and a word. */
function formatPercent(value: number): string {
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

const tournamentDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Los_Angeles",
});

/** A forward question's unit: dollars in billions or trillions. */
export type TournamentUnitLabel = "USD_B" | "USD_T";

/** What a question asks for and how it is shown; the service's `kind` and `unit`. */
export interface TournamentQuestionShape {
  readonly kind: "binary" | "forward";
  readonly unit: TournamentUnitLabel | null;
}

/** A forward level in its question's unit at four significant digits: $412.5B, $1.25T. */
export function formatTournamentValue(value: number, unit: TournamentUnitLabel): string {
  if (!Number.isFinite(value)) return "Unavailable";
  return `$${tournamentValueFormatter.format(value)}${tournamentUnitSuffix(unit)}`;
}

/** The suffix a forward's field and figures carry: B or T. */
export function tournamentUnitSuffix(unit: TournamentUnitLabel): "B" | "T" {
  return unit === "USD_T" ? "T" : "B";
}

/** Dollars into a forward's unit: a dealer mid or a round's post-money read beside a level. */
export function usdInTournamentUnit(usd: number, unit: TournamentUnitLabel): number {
  return usd / (unit === "USD_T" ? 1e12 : 1e9);
}

export function tournamentUnitName(unit: TournamentUnitLabel): string {
  return unit === "USD_T" ? "USD trillions" : "USD billions";
}

/** The board's and the page's caption: "Binary · by Dec 31, 2026" or "Forward · USD billions". */
export function tournamentKindCaption(
  question: TournamentQuestionShape & { readonly expiryAt: string },
): string {
  if (question.kind === "binary" || question.unit === null) {
    return `Binary · by ${formatTournamentDate(question.expiryAt)}`;
  }
  return `Forward · ${tournamentUnitName(question.unit)}`;
}

/**
 * One forecast or crowd figure by kind: "42.0% yes" for a binary's P(YES),
 * "$412B" for a forward's level. Null when the figure for the kind is absent.
 */
export function formatTournamentForecast(
  question: TournamentQuestionShape,
  figure: { readonly p: number | null; readonly value: number | null },
): string | null {
  if (question.kind === "binary") {
    return figure.p === null ? null : `${formatProbability(figure.p)} yes`;
  }
  if (question.unit === null || figure.value === null) return null;
  return formatTournamentValue(figure.value, question.unit);
}

/** A binary's outcome as resolved: YES or NO. */
export function formatTournamentOutcome(outcome: "yes" | "no"): string {
  return outcome.toUpperCase();
}

export function formatTournamentDateTime(value: string): string {
  return tournamentDateTimeFormatter.format(new Date(value));
}

/** A calendar date in the tournament's home zone, where its deadlines are written. */
export function formatTournamentDate(value: string): string {
  return tournamentDateFormatter.format(new Date(value));
}

/** A leaderboard period: "all" or "YYYY-MM". */
export function formatTournamentPeriod(period: string): string {
  if (period === "all") return "All time";
  return tournamentMonthFormatter.format(new Date(`${period}-01T00:00:00Z`));
}

/**
 * A tournament score, signed at one decimal with a true minus: 100 is a
 * binary held certain and right or a forward level exact; 0 is a binary
 * held at 50% or a forward missed by 2×.
 */
export function formatScore(value: number): string {
  return scoreFormatter.format(value).replace("-", "−");
}

const wholeScoreFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});

/** A score in a sentence: whole, signed, true minus ("+86", "0", "−58"); never green. */
export function formatScoreWhole(value: number): string {
  // Round first so −0.4 reads "0", not "−0".
  return wholeScoreFormatter.format(Math.round(value) || 0).replace("-", "−");
}

/** A level's first letter lowered for a sentence ("First-day market cap" → "first-day market cap"), unless it opens an acronym. */
function levelInSentence(label: string): string {
  const [first = "", second = ""] = label;
  return second !== second.toLowerCase() ? label : `${first.toLowerCase()}${label.slice(1)}`;
}

/** What a tournament question is about, as its settle sentences need it. */
export interface TournamentSettleShape extends TournamentQuestionShape {
  readonly levelLabel: string | null;
  readonly expiryAt: string;
}

/** The board's one-line cue: "Binary · settles by Dec 31, 2026" or "First-day market cap · settles at the print". */
export function tournamentSettleCue(question: TournamentSettleShape): string {
  if (question.kind === "binary" || question.unit === null) {
    return `Binary · settles by ${formatTournamentDate(question.expiryAt)}`;
  }
  return `${question.levelLabel ?? "Forward"} · settles at the print`;
}

/**
 * "How this settles", in two sentences from the question's own fields: what
 * settles it, then what happens otherwise. The condition itself is the
 * rulebook's, which the block links to rather than paraphrases.
 */
export function tournamentSettleSentences(
  question: TournamentSettleShape,
): readonly [string, string] {
  const by = formatTournamentDate(question.expiryAt);
  if (question.kind === "binary" || question.unit === null) {
    return [
      `Settles YES if what the question asks happens by ${by}, as the rulebook defines it.`,
      `Anything else, including nothing by ${by}, is NO.`,
    ];
  }
  const level =
    question.levelLabel === null
      ? `figure the rulebook names, in ${tournamentUnitName(question.unit)},`
      : levelInSentence(question.levelLabel);
  return [
    `Settles at the ${level} when it prints.`,
    `If nothing prints by ${by}, the question voids and nobody is scored.`,
  ];
}

/** A forward's score at the level typed and at fixed misses either side; every score from the engine. */
export interface ForwardScoreLadder {
  readonly level: number;
  /** Exact, then each miss ratio: the levels above and below at that ratio and their score. */
  readonly rungs: readonly {
    readonly above: number;
    readonly below: number;
    readonly score: number;
  }[];
}

/** "You enter $1.3T. If it settles at $1.3T you score +100; at $1.43T or $1.182T, +86; at $2.6T or $0.65T, 0." */
export function formatForwardScoreLadder(
  ladder: ForwardScoreLadder,
  unit: TournamentUnitLabel,
): string {
  const level = formatTournamentValue(ladder.level, unit);
  const clauses = ladder.rungs.map((rung, index) => {
    const at =
      rung.above === rung.below
        ? formatTournamentValue(rung.above, unit)
        : `${formatTournamentValue(rung.above, unit)} or ${formatTournamentValue(rung.below, unit)}`;
    return index === 0
      ? `If it settles at ${at} you score ${formatScoreWhole(rung.score)}`
      : `at ${at}, ${formatScoreWhole(rung.score)}`;
  });
  return `You enter ${level}. ${clauses.join("; ")}.`;
}

/** "If it settles at the crowd median, $1.25T, you score +94." */
export function formatScoreAtFigure(
  name: string,
  level: number,
  score: number,
  unit: TournamentUnitLabel,
): string {
  return `If it settles at the ${name}, ${formatTournamentValue(level, unit)}, you score ${formatScoreWhole(score)}.`;
}

/** The binary's two reference points: what 50% and the most certain chance allowed score. */
export interface BinaryScoreBounds {
  /** The score of 50%, either way. */
  readonly even: number;
  /** The most certain chance the field takes, and what it scores right and wrong. */
  readonly sure: number;
  readonly sureRight: number;
  readonly sureWrong: number;
}

/** "50% scores 0 either way; 99.9% scores +99.9 if right and −896.6 if wrong." */
export function formatBinaryScoreBounds(bounds: BinaryScoreBounds): string {
  return `50% scores ${formatScore(bounds.even)} either way; ${formatProbability(bounds.sure)} scores ${formatScore(bounds.sureRight)} if right and ${formatScore(bounds.sureWrong)} if wrong.`;
}

/** The span a window is counted in: days, or hours under two days, or minutes under two hours. */
export type WindowSpanUnit = "day" | "hour" | "minute";

/** How much of a question's open window a forecast counts for, in whole units of the window's span. */
export interface WindowCoverage {
  readonly unit: WindowSpanUnit;
  readonly total: number;
  readonly covered: number;
  /** When the forecast in force started counting; null when the viewer has none (it would start now). */
  readonly since: string | null;
  /** A revision hides when the first forecast came, so `covered` is a lower bound. */
  readonly atLeast: boolean;
}

/** "41 days", "1 day", "36 hours", "61 minutes". */
export function formatWindowSpan(count: number, unit: WindowSpanUnit): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * The time-averaging rule said once, with the viewer's own numbers: what
 * counts, then how much of the window their forecast covers.
 */
export function formatTimeAverageNote(
  kind: "binary" | "forward",
  coverage: WindowCoverage,
): readonly [string, string] {
  const total = formatWindowSpan(coverage.total, coverage.unit);
  const zero = kind === "binary" ? "the score of 50%" : "the score of a 2× miss";
  const rule = `Your score is averaged over the whole open window, ${total}; time before your first forecast counts as 0, ${zero}.`;
  const covered = `${coverage.covered} of those ${total}`;
  if (coverage.since === null) {
    return [rule, `Forecast now and your number counts for ${covered}.`];
  }
  const since = formatTournamentDate(coverage.since);
  return [
    rule,
    coverage.atLeast
      ? `Your forecasts count from ${since} or earlier to the close: at least ${covered}.`
      : `Your forecast counts from ${since} to the close: ${covered}.`,
  ];
}

/** Share of a window with a forecast on file; a sliver never rounds down to 0%. */
export function formatCoverage(value: number): string {
  if (value > 0 && value < 0.01) return "<1%";
  return wholePercentFormatter.format(value);
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

/** Sigma is a model parameter, shown with two decimal places. */
export function formatSigma(value: number): string {
  return value.toFixed(2);
}
export function formatForwardNotional(quantity: number): string {
  return formatCents(String(Math.round(quantity * 100)));
}
/** Whole-dollar chips and opening-balance copy retain their existing precision. */
export function formatWholeUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
