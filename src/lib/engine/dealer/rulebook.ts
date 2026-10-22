import { assertDate } from "../assert.js";

/**
 * The settlement rulebook as code (README D13, CONTRACTS.md). Pure: it says
 * what counts, how sources rank, and how an instrument resolves from the
 * events it is shown. Deciding which flags are those events is the settle
 * job's work; publishing this table is /api/ref/rulebook's.
 *
 * Every change to a rule bumps RULEBOOK_VERSION and must still resolve
 * backtest/events.csv as tests/fixtures/rulebook-events.json records, or
 * re-baseline that file in the same commit.
 */
export const RULEBOOK_VERSION = "1.0.0";

const DAY_MS = 86_400_000;

export type SourceRank = 1 | 2 | 3 | 4;

export type ValuationBasis = "pre" | "post" | "unknown";

/**
 * `event_flags.terms_json`. Only valuation_usd and valuation_basis are
 * load-bearing; the ingest records a reported range as its midpoint.
 */
export interface FlagTerms {
  readonly amount_usd?: number;
  readonly valuation_usd?: number;
  readonly valuation_basis: ValuationBasis;
  readonly lead?: string;
  readonly pps_usd?: number;
  readonly outlet?: string;
  readonly quote?: string;
}

/** What a corporate event is, before asking whether it settles anything. */
export const EVENT_TYPES = [
  "priced_round",
  "ipo",
  "public_s1",
  "tender_or_secondary",
  "same_price_extension",
  "safe_or_note",
  "debt",
  "acquisition",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Which event resolves a name's binary: labs file an S-1, everyone else raises. */
export type BinaryEvent = "priced_round" | "public_s1";

const TIER1_OUTLETS = [
  "Bloomberg",
  "Reuters",
  "The Wall Street Journal",
  "Financial Times",
  "The Information",
  "TechCrunch",
  "Axios",
  "The New York Times",
] as const;

const OUTLET_ALIASES: Readonly<Record<string, (typeof TIER1_OUTLETS)[number]>> = {
  bloomberg: "Bloomberg",
  "bloomberg news": "Bloomberg",
  reuters: "Reuters",
  wsj: "The Wall Street Journal",
  "wall street journal": "The Wall Street Journal",
  "the wall street journal": "The Wall Street Journal",
  "wall st. journal": "The Wall Street Journal",
  ft: "Financial Times",
  "financial times": "Financial Times",
  "the financial times": "Financial Times",
  "the information": "The Information",
  techcrunch: "TechCrunch",
  axios: "Axios",
  nyt: "The New York Times",
  "new york times": "The New York Times",
  "the new york times": "The New York Times",
  nytimes: "The New York Times",
};

export const RULEBOOK = {
  version: RULEBOOK_VERSION,
  print: {
    definition: "The post-money valuation of a priced primary equity round, publicly reported.",
    also_for_labs: "An IPO's first-day closing market capitalisation.",
    not_prints: [
      "SAFEs and convertible notes",
      "same-price extensions",
      "secondaries and tenders",
      "debt",
    ],
    conversions: [
      "A pre-money valuation plus the amount raised is the post-money.",
      "A reported range settles at its midpoint (the ingest records the midpoint).",
      "Price per share alone does not settle.",
    ],
  },
  announcement:
    "The first public, dated statement that a priced round closed. Reporting that a round is in talks is not an announcement.",
  source_ranks: [
    { rank: 1, source: "Company or lead-investor release" },
    { rank: 2, source: "SEC filing" },
    { rank: 3, source: "Two independent Tier-1 outlets citing closed terms" },
    { rank: 4, source: "One Tier-1 outlet citing closed terms" },
  ],
  tier1_outlets: TIER1_OUTLETS,
  syndication:
    "Syndicated copies of one report count as one outlet: a reprint counts under the outlet that originated it.",
  charter: "A state charter's price per share re-centres the model mid and never settles.",
  revision_window_days: 7,
  revision:
    "A higher-ranked source dated within the revision window of the first print supersedes it, even when dated after expiry. A settlement is final once nothing can outrank it or the window and the observation grace have passed.",
  observation_grace_days: 1,
  review: {
    auto_resolve_max_rank: 2,
    review_hours: 24,
  },
  binary: {
    resolves_yes:
      "On the first qualifying announcement at or before quarter-end 23:59:59.999 UTC: a priced round (labs: a public S-1).",
    resolves_no: "One day after quarter-end, if nothing qualified.",
    undisclosed_valuation: "A priced round with an undisclosed valuation still resolves YES.",
    labs: "A confidential S-1 resolves only once it is public before quarter-end.",
    window:
      "Any qualifying announcement strictly after the binary's listing time and at or before its expiry counts, including a second round in the same calendar quarter (decision 0002).",
    expiry_floor_days: 21,
    expiry:
      "The current calendar quarter-end if at least 21 days remain at listing, otherwise the next quarter-end.",
    roll: "Each successor lists the same day its predecessor resolves or expires.",
  },
  forward: {
    settles:
      "On the first print after the position's instrument opened, with a qualifying post-money dated at or before expiry.",
    undisclosed_valuation:
      "Waits until expiry for a qualifying post-money, then voids with full refund.",
    void: "No print by expiry voids every position with full refund of collateral.",
    down_rounds: "Settle normally; shorts are paid.",
    acquisition:
      "An acquisition before a print settles at a disclosed cash-equivalent equity value; with none disclosed the forward voids when it is announced.",
    roll: "On settlement the successor opens anchored on the print; on void, at the current mid.",
  },
} as const;

/** Post-money in USD from extracted terms, or null when the valuation is undisclosed. */
export function postMoneyUsd(terms: FlagTerms): number | null {
  const valuation = terms.valuation_usd;
  if (!isPositiveFinite(valuation)) return null;
  if (terms.valuation_basis === "post") return valuation;
  if (terms.valuation_basis === "pre" && isPositiveFinite(terms.amount_usd)) {
    const post = valuation + terms.amount_usd;
    return Number.isFinite(post) ? post : null;
  }
  return null;
}

function tier1Outlet(outlet: string): (typeof TIER1_OUTLETS)[number] | null {
  return OUTLET_ALIASES[outlet.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;
}

/**
 * Rank of press evidence: distinct Tier-1 outlets. Pass each report's
 * originating outlet, so a syndicated reprint counts under its originator.
 */
export function pressRank(outlets: readonly string[]): 3 | 4 | null {
  const distinct = new Set(outlets.map(tier1Outlet).filter((outlet) => outlet !== null));
  if (distinct.size >= 2) return 3;
  if (distinct.size === 1) return 4;
  return null;
}

/** Whether an event of this type is a print for the forward. */
export function isPrint(eventType: EventType, binaryEvent: BinaryEvent): boolean {
  return eventType === "priced_round" || (eventType === "ipo" && binaryEvent === "public_s1");
}

/** Whether an event of this type resolves the binary YES. */
export function resolvesBinary(eventType: EventType, binaryEvent: BinaryEvent): boolean {
  return eventType === binaryEvent;
}

/** One dated, sourced corporate event the settle job puts in front of the rulebook. */
export interface RulebookEvent {
  readonly id: string;
  readonly eventType: EventType;
  /** published_at when known, otherwise observed_at. */
  readonly announcedAt: Date;
  readonly rank: SourceRank;
  /** Null when the valuation is undisclosed; an acquisition's equity value otherwise. */
  readonly postMoneyUsd: number | null;
}

/** The last millisecond of the calendar quarter containing `at`, UTC. */
export function quarterEndCutoff(at: Date): Date {
  assertDate(at, "at");
  const quarter = Math.floor(at.getUTCMonth() / 3);
  return new Date(Date.UTC(at.getUTCFullYear(), quarter * 3 + 3, 0, 23, 59, 59, 999));
}

/**
 * A binary's expiry for a listing at `listedAt`: the current quarter's cutoff
 * when at least expiry_floor_days whole days remain, otherwise the next one.
 */
export function binaryExpiry(listedAt: Date): Date {
  const cutoff = quarterEndCutoff(listedAt);
  const daysLeft = Math.floor((utcMidnight(cutoff) - utcMidnight(listedAt)) / DAY_MS);
  if (daysLeft >= RULEBOOK.binary.expiry_floor_days) return cutoff;
  return quarterEndCutoff(new Date(cutoff.getTime() + 1));
}

function utcMidnight(at: Date): number {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

export type BinaryResolution =
  | { readonly status: "open" }
  | { readonly status: "no" }
  | { readonly status: "yes"; readonly eventId: string; readonly at: Date };

export interface BinaryTerms {
  readonly binaryEvent: BinaryEvent;
  readonly opensAt: Date;
  readonly cutoff: Date;
}

export function resolveBinary(
  terms: BinaryTerms,
  events: readonly RulebookEvent[],
  asOf: Date,
): BinaryResolution {
  validateResolutionDates(terms.opensAt, terms.cutoff, events, asOf);
  const first = earliest(
    events.filter(
      (event) =>
        resolvesBinary(event.eventType, terms.binaryEvent) &&
        event.announcedAt > terms.opensAt &&
        event.announcedAt <= terms.cutoff &&
        event.announcedAt <= asOf,
    ),
  );
  if (first !== undefined) return { status: "yes", eventId: first.id, at: first.announcedAt };
  return afterGrace(terms.cutoff, asOf) ? { status: "no" } : { status: "open" };
}

export type ForwardResolution =
  | { readonly status: "open" }
  | { readonly status: "void" }
  | {
      readonly status: "settled";
      readonly eventId: string;
      readonly at: Date;
      readonly rank: SourceRank;
      readonly settleLn: number;
      /** False while a higher-ranked source could still supersede it. */
      readonly final: boolean;
    };

export interface ForwardTerms {
  readonly binaryEvent: BinaryEvent;
  readonly opensAt: Date;
  readonly expiresAt: Date;
}

export function resolveForward(
  terms: ForwardTerms,
  events: readonly RulebookEvent[],
  asOf: Date,
): ForwardResolution {
  validateResolutionDates(terms.opensAt, terms.expiresAt, events, asOf);
  const observed = events.filter(
    (event) => event.announcedAt > terms.opensAt && event.announcedAt <= asOf,
  );
  const settling = observed.filter((event) => settlesForward(event, terms.binaryEvent));
  const first = earliest(settling.filter((event) => event.announcedAt <= terms.expiresAt));
  const blindAcquisition = earliest(
    observed.filter(
      (event) =>
        event.eventType === "acquisition" &&
        event.postMoneyUsd === null &&
        event.announcedAt <= terms.expiresAt,
    ),
  );
  if (
    blindAcquisition !== undefined &&
    (first === undefined || blindAcquisition.announcedAt < first.announcedAt)
  ) {
    return { status: "void" };
  }
  if (first === undefined) {
    return afterGrace(terms.expiresAt, asOf) ? { status: "void" } : { status: "open" };
  }

  // A higher-ranked source dated inside the revision window supersedes the
  // first print, even past expiry; among equally ranked sources the first
  // one stands. Nothing outranks rank 1, so a rank-1 settlement is final at once.
  const windowEnd = first.announcedAt.getTime() + RULEBOOK.revision_window_days * DAY_MS;
  const inWindow = settling.filter((event) => event.announcedAt.getTime() <= windowEnd);
  const bestRank = Math.min(...inWindow.map((event) => event.rank));
  const settled = earliest(inWindow.filter((event) => event.rank === bestRank))!;
  return {
    status: "settled",
    eventId: settled.id,
    at: settled.announcedAt,
    rank: settled.rank,
    settleLn: Math.log(settled.postMoneyUsd!),
    final: bestRank === 1 || afterGrace(new Date(windowEnd), asOf),
  };
}

/** A print, or an acquisition at a disclosed equity value; either needs a figure. */
function settlesForward(event: RulebookEvent, binaryEvent: BinaryEvent): boolean {
  return (
    event.postMoneyUsd !== null &&
    (isPrint(event.eventType, binaryEvent) || event.eventType === "acquisition")
  );
}

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function afterGrace(deadline: Date, asOf: Date): boolean {
  return asOf.getTime() > deadline.getTime() + RULEBOOK.observation_grace_days * DAY_MS;
}

function earliest(events: readonly RulebookEvent[]): RulebookEvent | undefined {
  let first: RulebookEvent | undefined;
  for (const event of events) {
    if (first === undefined || event.announcedAt < first.announcedAt) first = event;
  }
  return first;
}

function validateResolutionDates(
  opensAt: Date,
  expiresAt: Date,
  events: readonly RulebookEvent[],
  asOf: Date,
): void {
  assertDate(opensAt, "opensAt");
  assertDate(expiresAt, "expiresAt");
  assertDate(asOf, "asOf");
  for (const event of events) assertDate(event.announcedAt, "announcedAt");
}
