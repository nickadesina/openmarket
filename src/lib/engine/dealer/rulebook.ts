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

/** Kinds of public evidence the ingest records (`event_flags.kind`). */
export const FLAG_KINDS = [
  "form_d",
  "form_d_amend",
  "charter",
  "scoop",
  "release",
  "s1_public",
  "print",
  "user_submitted",
] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

export type ValuationBasis = "pre" | "post" | "unknown";

/** `event_flags.terms_json`. Only valuation_usd and valuation_basis are load-bearing. */
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
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Which event resolves a name's binary: labs file an S-1, everyone else raises. */
export type BinaryEvent = "priced_round" | "public_s1";

export const TIER1_OUTLETS = [
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
  ft: "Financial Times",
  "financial times": "Financial Times",
  "the information": "The Information",
  techcrunch: "TechCrunch",
  axios: "Axios",
  nyt: "The New York Times",
  "new york times": "The New York Times",
  "the new york times": "The New York Times",
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
      "A reported range settles at its midpoint.",
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
  syndication: "Syndicated copies of one report count as one outlet.",
  charter: "A state charter's price per share re-centres the model mid and never settles.",
  revision_window_days: 7,
  revision: "A higher-ranked source within the revision window supersedes the settling source.",
  observation_grace_days: 1,
  review: {
    auto_resolve_max_rank: 2,
    review_hours: 24,
  },
  binary: {
    resolves_yes:
      "On the first qualifying announcement at or before quarter-end 23:59:59 UTC: a priced round (labs: a public S-1).",
    resolves_no: "One day after quarter-end, if nothing qualified.",
    undisclosed_valuation: "A priced round with an undisclosed valuation still resolves YES.",
    labs: "A confidential S-1 resolves only once it is public before quarter-end.",
    roll: "An early YES lists the next quarter's binary the same day.",
  },
  forward: {
    settles:
      "On the first print after the position's instrument opened, with a qualifying post-money dated at or before expiry.",
    undisclosed_valuation:
      "Waits until expiry for a qualifying post-money, then voids with full refund.",
    void: "No print by expiry voids every position with full refund of collateral.",
    down_rounds: "Settle normally; shorts are paid.",
    acquisition:
      "Settles only if a cash-equivalent equity value is disclosed; otherwise the forward voids.",
    roll: "On settlement the successor opens anchored on the print; on void, at the current mid.",
  },
} as const;

/** Post-money in USD from extracted terms, or null when the valuation is undisclosed. */
export function postMoneyUsd(terms: FlagTerms): number | null {
  const valuation = terms.valuation_usd;
  if (valuation === undefined || !Number.isFinite(valuation) || valuation <= 0) return null;
  if (terms.valuation_basis === "post") return valuation;
  if (terms.valuation_basis === "pre" && terms.amount_usd !== undefined && terms.amount_usd > 0) {
    return valuation + terms.amount_usd;
  }
  return null;
}

export function tier1Outlet(outlet: string): (typeof TIER1_OUTLETS)[number] | null {
  return OUTLET_ALIASES[outlet.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;
}

/** Rank of press evidence: distinct Tier-1 outlets, syndications counted once. */
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
  /** Null when the valuation is undisclosed. */
  readonly postMoneyUsd: number | null;
}

/** 23:59:59 UTC on the last day of the calendar quarter containing `at`. */
export function quarterEndCutoff(at: Date): Date {
  const quarter = Math.floor(at.getUTCMonth() / 3);
  return new Date(Date.UTC(at.getUTCFullYear(), quarter * 3 + 3, 0, 23, 59, 59));
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
  const prints = events.filter(
    (event) =>
      isPrint(event.eventType, terms.binaryEvent) &&
      event.postMoneyUsd !== null &&
      event.announcedAt > terms.opensAt &&
      event.announcedAt <= terms.expiresAt &&
      event.announcedAt <= asOf,
  );
  const first = earliest(prints);
  if (first === undefined) {
    return afterGrace(terms.expiresAt, asOf) ? { status: "void" } : { status: "open" };
  }

  // A higher-ranked source inside the revision window supersedes the first
  // print; among equally ranked sources the first one stands.
  const windowEnd = first.announcedAt.getTime() + RULEBOOK.revision_window_days * DAY_MS;
  const inWindow = prints.filter((event) => event.announcedAt.getTime() <= windowEnd);
  const bestRank = Math.min(...inWindow.map((event) => event.rank));
  const settling = earliest(inWindow.filter((event) => event.rank === bestRank))!;
  return {
    status: "settled",
    eventId: settling.id,
    at: settling.announcedAt,
    rank: settling.rank,
    settleLn: Math.log(settling.postMoneyUsd!),
    final: asOf.getTime() > windowEnd,
  };
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
