import { assertDate } from "./assert.js";

/**
 * The rulebook as code (README D13, decision 0003, CONTRACTS.md). Pure: it
 * says what a print is and how its sources rank, how the mark-side source
 * classes rank within each purpose, and the rules every contract on the
 * index shares. OpenMarket quotes, lists and settles none of those
 * contracts; publishing this table is /api/ref/rulebook's work.
 *
 * Every change to a rule bumps RULEBOOK_VERSION (docs/RULEBOOK_CHANGELOG.md)
 * and must still resolve data/round-history/events.csv as
 * tests/fixtures/rulebook-events.json records, or re-baseline that file in
 * the same commit.
 */
export const RULEBOOK_VERSION = "2.1.0";

import { DAY_MS, utcMidnight } from "./time.js";

/** A print's source rank on the print side (RULEBOOK.source_ranks). */
export type PrintRank = 1 | 2 | 3 | 4;

export type ValuationBasis = "pre" | "post" | "unknown";

/** A round's reported terms. Only these fields are load-bearing for a print. */
export interface RoundTerms {
  readonly amount_usd?: number;
  readonly valuation_usd?: number;
  readonly valuation_basis: ValuationBasis;
}

/** What a corporate event is, before asking whether it is a print. */
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

/** A lab's IPO first-day close is also a print (RULEBOOK.print.also_for_labs). */
export type NameKind = "company" | "lab";

/**
 * Events after which filers re-mark a name on information its insiders had
 * first. One announced inside the window of a contract that settles on
 * marks voids it (RULEBOOK.contracts.repricing).
 */
export const REPRICING_EVENTS = [
  "priced_round",
  "tender_or_secondary",
  "public_s1",
  "ipo",
  "acquisition",
] as const satisfies readonly EventType[];

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

/**
 * The mark-side source classes: `source_documents.source_class` (migration
 * 020_marks_index, docs/prompts/v2/README.md). The order is the enum's.
 */
export const SOURCE_CLASSES = [
  "ncsr",
  "nport",
  "fund_holdings_page",
  "closed_end_nav",
  "delaware_coi",
  "form_d",
  "spv_quote_page",
  "company_statement",
  "press",
] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

/** What a source can establish. A rank orders sources within one purpose, never across. */
export const SOURCE_PURPOSES = [
  "filer_mark",
  "print_price_and_terms",
  "round_size_and_date",
  "spv_existence_and_terms",
  "unit_quote",
] as const;
export type SourcePurpose = (typeof SOURCE_PURPOSES)[number];

/** free: a public filing; paid_per_document: bought from a public registry; public_page: served without a login. */
export type SourceAccess = "free" | "paid_per_document" | "public_page";

interface SourcePurposeRule {
  readonly purpose: SourcePurpose;
  readonly establishes: string;
  /** Rank 1 is best. Unique within the purpose; a gap is explained in `note`. */
  readonly ranks: readonly { readonly rank: number; readonly source_class: SourceClass }[];
  readonly note?: string;
}

interface SourceClassRule {
  readonly source_class: SourceClass;
  readonly document: string;
  /** The purpose ingest reads the class for; `source_documents.source_rank` is its rank there. */
  readonly purpose: SourcePurpose;
  readonly cadence: string;
  readonly lag: string;
  readonly access: SourceAccess;
}

const SOURCE_PURPOSE_RULES = [
  {
    purpose: "filer_mark",
    establishes: "A filer's per-share mark on one security as of one date.",
    ranks: [
      { rank: 1, source_class: "ncsr" },
      { rank: 2, source_class: "nport" },
      { rank: 3, source_class: "fund_holdings_page" },
      { rank: 4, source_class: "closed_end_nav" },
    ],
    note: "A rank picks which of one filer's documents stands for a security and date (the N-CSR over the N-PORT for the same fund and date). It never weighs one filer against another.",
  },
  {
    purpose: "print_price_and_terms",
    establishes:
      "A round's per-share price and its terms: liquidation preference, participation, seniority, shares authorized.",
    ranks: [
      { rank: 1, source_class: "delaware_coi" },
      { rank: 2, source_class: "company_statement" },
    ],
    note: "The index's mark versus print uses a rank-1 price only.",
  },
  {
    purpose: "round_size_and_date",
    establishes:
      "A round's size and date: amount raised, announcement or first sale. The print's post-money ranks by the print-side source ranks, which these restate by class.",
    ranks: [
      { rank: 1, source_class: "company_statement" },
      { rank: 2, source_class: "form_d" },
      { rank: 4, source_class: "press" },
    ],
    note: "One press report ranks 4; two independent Tier-1 reports of the same terms together rank 3 (pressRank).",
  },
  {
    purpose: "spv_existence_and_terms",
    establishes:
      "That an SPV holding the name exists, and its terms: offering size, minimum investment, commissions and fees.",
    ranks: [
      { rank: 1, source_class: "form_d" },
      { rank: 2, source_class: "spv_quote_page" },
    ],
  },
  {
    purpose: "unit_quote",
    establishes: "A quoted price for one unit of an SPV, as of the page's capture.",
    ranks: [{ rank: 1, source_class: "spv_quote_page" }],
  },
] as const satisfies readonly SourcePurposeRule[];

const SOURCE_CLASS_RULES = [
  {
    source_class: "ncsr",
    document:
      "Form N-CSR (annual, audited) or N-CSRS (semiannual): a registered fund's schedule of investments.",
    purpose: "filer_mark",
    cadence: "Semiannual.",
    lag: "The shareholder report goes out within 60 days of the period's end and is filed within 10 days after.",
    access: "free",
  },
  {
    source_class: "nport",
    document: "Form N-PORT-P: a registered fund's portfolio holdings, position by position.",
    purpose: "filer_mark",
    cadence: "Quarterly: the third month of each fiscal quarter is made public.",
    lag: "About 60 days after the fiscal quarter's end.",
    access: "free",
  },
  {
    source_class: "fund_holdings_page",
    document:
      "A fund adviser's published holdings page (Fidelity's monthly holdings, ARK Venture).",
    purpose: "filer_mark",
    cadence: "As the adviser publishes it.",
    lag: "Set by the adviser's disclosure policy and stated on the page.",
    access: "public_page",
  },
  {
    source_class: "closed_end_nav",
    document: "A listed closed-end fund's NAV and holdings page (DXYZ).",
    purpose: "filer_mark",
    cadence: "As the fund publishes it.",
    lag: "Stated on the page.",
    access: "public_page",
  },
  {
    source_class: "delaware_coi",
    document:
      "A Delaware certificate of incorporation, restated or amended: a certified copy from the Division of Corporations.",
    purpose: "print_price_and_terms",
    cadence: "On each filing: a new preferred series amends or restates the certificate.",
    lag: "On order, once filed.",
    access: "paid_per_document",
  },
  {
    source_class: "form_d",
    document: "SEC Form D: notice of an exempt offering, by the company or by an SPV.",
    purpose: "spv_existence_and_terms",
    cadence: "Per offering, amended at least yearly while it continues.",
    lag: "Within 15 days of the first sale.",
    access: "free",
  },
  {
    source_class: "spv_quote_page",
    document: "A page quoting an SPV's units and terms, served without a login.",
    purpose: "unit_quote",
    cadence: "At each capture.",
    lag: "None: the capture time is the as-of.",
    access: "public_page",
  },
  {
    source_class: "company_statement",
    document: "A release or statement by the company or by the round's lead investor.",
    purpose: "round_size_and_date",
    cadence: "Per event.",
    lag: "None: dated by its publication.",
    access: "public_page",
  },
  {
    source_class: "press",
    document:
      "A report by a Tier-1 outlet. A report behind a login or a paywall is not an input (decision 0003, section 4).",
    purpose: "round_size_and_date",
    cadence: "Per event.",
    lag: "None: dated by its publication.",
    access: "public_page",
  },
] as const satisfies readonly SourceClassRule[];

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
      "A reported range counts at its midpoint.",
      "Price per share alone is not a post-money.",
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
  certificate:
    "A Delaware certificate of incorporation is never a print: it states no post-money. It ranks first for a round's per-share price and terms.",
  revision_window_days: 7,
  revision:
    "A higher-ranked source dated within the revision window of a print's first report supersedes it; among equal ranks the first stands. A print is final once nothing can outrank it, or once the window and the observation grace have passed.",
  observation_grace_days: 1,
  marks: {
    unit: "One per-share mark on one security, from one filer, as of one date, with its source document.",
    never_adjusted:
      "A filer's mark is never adjusted, interpolated, smoothed or carried forward. A missing filing is a missing row.",
    source_rule:
      "Every input is a public filing, a document bought from a public registry, or a price on a page served without a login.",
    ranks:
      "A source class ranks within a purpose, never across purposes. source_documents.source_rank is the class's rank in the purpose ingest reads it for.",
  },
  source_purposes: SOURCE_PURPOSE_RULES,
  source_classes: SOURCE_CLASS_RULES,
  contracts: {
    designs_only:
      "OpenMarket designs the contracts in CONTRACTS.md and quotes, lists and settles none of them. A venue that lists one licenses the feed and names the index's versions in its rulebook.",
    kinds: [
      "mark-level binary",
      "dispersion range",
      "mark versus print",
      "perp basis",
      "structure spread",
    ],
    settles_on_marks:
      "The mark-level binary and the dispersion range settle on filer marks: a named filer's next disclosed mark, or the spread of filer families' marks on one as-of date within the contract's quarter.",
    settles_on_prints:
      "Mark versus print, perp basis and structure spread settle on the next priced round, through its certificate.",
    versions:
      "A contract names the methodology_version, ce_version where it uses one, and rulebook_version it settles under; a later version never changes its settlement.",
    observation_lag_days: 75,
    observation:
      "A contract on calendar quarter Q reads the index as published at 00:00 UTC on the 75th day after Q's last day. A row published after a contract's observation date or deadline does not enter.",
    listing_floor_days: 21,
    listing:
      "A contract on a calendar quarter observes the quarter it lists in if at least 21 days remain, otherwise the next one.",
    repricing:
      "A contract that settles on marks voids on a priced round, tender or secondary, public S-1, IPO or acquisition of the name announced strictly after listing and at or before the as-of of the marks it reads, at any rank, valuation disclosed or not. A contract that settles on a print does not: the round is its settlement event.",
    next_round:
      "A contract that settles on a print settles on the next priced round: the first announced strictly after listing and at or before the contract's deadline, at any rank, valuation disclosed or not. The venue closes it to new positions at the round's first public report.",
    exit: "An acquisition or IPO announced after listing and before the next priced round voids a contract that settles on a print.",
    no_print:
      "A contract that settles on a print voids when no priced round is announced by its deadline.",
    no_certificate:
      "A contract that settles on a print also voids when, by its settlement date (the deadline plus the venue's certificate lag), the index holds no certificate for the round giving a per-share price for the new series.",
    no_filing:
      "A contract that settles on marks voids when the filers it reads publish no mark on its label by its observation date or deadline, or fewer families than its minimum.",
    filer_stops:
      "A filer that stops filing is a missing row: its last mark is never carried forward, and a series is computed from the families present.",
    correction:
      "A correction published before a contract's observation date or settlement date enters. One published after it does not re-settle: the index publishes the correction with its diff and the settled value stands.",
    void: "A void cancels every position; the listing venue refunds under its own rulebook.",
  },
} as const;

/**
 * Rules in RULEBOOK that are the contracts' intent but that no code serves
 * yet. `rule` is the rule's path in RULEBOOK. /rulebook and /api/ref/rulebook
 * mark them from this list; an entry leaves when its code lands.
 */
export const NOT_BUILT: readonly { readonly rule: string; readonly note: string }[] = [
  {
    rule: "contracts.observation",
    note: "No route serves the index as published on a past date. Every row records when it was fetched and created, so the value at an observation date can be recomputed from the rows.",
  },
  {
    rule: "contracts.versions",
    note: "The index publishes each series under the current methodology_version only. A contract naming an earlier version settles on the value recomputed from the published rows under that version.",
  },
];

/** The mark-side table, by class. */
const CLASS_RULE: ReadonlyMap<SourceClass, SourceClassRule> = new Map(
  SOURCE_CLASS_RULES.map((rule) => [rule.source_class, rule]),
);

export function isSourceClass(value: string): value is SourceClass {
  return (SOURCE_CLASSES as readonly string[]).includes(value);
}

/**
 * A source class's rank within `purpose` (1 is best), as RULEBOOK.source_purposes
 * states it. Without `purpose`, the class's own purpose: the rank ingest
 * stores on `source_documents.source_rank`. Throws when the class does not
 * establish the purpose; a rank never compares classes across purposes.
 */
export function sourceRank(sourceClass: SourceClass, purpose?: SourcePurpose): number {
  const rule = CLASS_RULE.get(sourceClass);
  if (rule === undefined) throw new RangeError(`unknown source class ${String(sourceClass)}`);
  const target = purpose ?? rule.purpose;
  const ranks: SourcePurposeRule["ranks"] =
    SOURCE_PURPOSE_RULES.find((entry) => entry.purpose === target)?.ranks ?? [];
  const entry = ranks.find((row) => row.source_class === sourceClass);
  if (entry === undefined) {
    throw new RangeError(`source class ${sourceClass} does not establish ${target}`);
  }
  return entry.rank;
}

/** Post-money in USD from reported terms, or null when the valuation is undisclosed. */
export function postMoneyUsd(terms: RoundTerms): number | null {
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

/** Whether an event of this type is a print. */
export function isPrint(eventType: EventType, nameKind: NameKind): boolean {
  return eventType === "priced_round" || (eventType === "ipo" && nameKind === "lab");
}

/** Whether an event of this type voids a contract when announced inside its window. */
export function isRepricing(eventType: EventType): boolean {
  return (REPRICING_EVENTS as readonly EventType[]).includes(eventType);
}

/** One dated, sourced corporate event put in front of the rulebook. */
export interface RulebookEvent {
  readonly id: string;
  readonly eventType: EventType;
  /** published_at when known, otherwise observed_at. */
  readonly announcedAt: Date;
  readonly rank: PrintRank;
  /** Null when the valuation is undisclosed. */
  readonly postMoneyUsd: number | null;
}

/** The last millisecond of the calendar quarter containing `at`, UTC. */
export function quarterEndCutoff(at: Date): Date {
  assertDate(at, "at");
  const quarter = Math.floor(at.getUTCMonth() / 3);
  return new Date(Date.UTC(at.getUTCFullYear(), quarter * 3 + 3, 0, 23, 59, 59, 999));
}

/**
 * The cutoff of the quarter a contract listed at `listedAt` observes: the
 * current quarter's when at least listing_floor_days whole days remain,
 * otherwise the next one's (decision 0002's floor).
 */
export function observedQuarterEnd(listedAt: Date): Date {
  const cutoff = quarterEndCutoff(listedAt);
  const daysLeft = Math.floor((utcMidnight(cutoff) - utcMidnight(listedAt)) / DAY_MS);
  if (daysLeft >= RULEBOOK.contracts.listing_floor_days) return cutoff;
  return quarterEndCutoff(new Date(cutoff.getTime() + 1));
}

/** 00:00 UTC on the observation_lag_days-th day after the quarter ending at `cutoff`. */
export function observationDate(cutoff: Date): Date {
  return new Date(utcMidnight(cutoff) + RULEBOOK.contracts.observation_lag_days * DAY_MS);
}

export type RepricingResolution =
  | { readonly status: "open" }
  | { readonly status: "clear" }
  | { readonly status: "void"; readonly eventId: string; readonly at: Date };

export interface ContractWindow {
  /** The contract's listing time; an event at exactly this instant is outside. */
  readonly opensAt: Date;
  /**
   * The as-of of the marks a mark-settled contract reads (the observed
   * quarter's cutoff, or the named filer's next mark date), or a
   * print-settled contract's deadline.
   */
  readonly cutoff: Date;
}

/** The first event in (opensAt, cutoff] and at or before asOf that `matches`. */
function firstInWindow(
  window: ContractWindow,
  events: readonly RulebookEvent[],
  asOf: Date,
  matches: (eventType: EventType) => boolean,
): RulebookEvent | undefined {
  assertDate(window.opensAt, "opensAt");
  assertDate(window.cutoff, "cutoff");
  validateEvents(events, asOf);
  return earliest(
    events.filter(
      (event) =>
        matches(event.eventType) &&
        event.announcedAt > window.opensAt &&
        event.announcedAt <= window.cutoff &&
        event.announcedAt <= asOf,
    ),
  );
}

/**
 * RULEBOOK.contracts.repricing, for a contract that settles on marks: void
 * on the first repricing event announced in (opensAt, cutoff], valuation
 * disclosed or not; clear once the cutoff and the observation grace have
 * passed with none; open until then.
 */
export function resolveRepricing(
  window: ContractWindow,
  events: readonly RulebookEvent[],
  asOf: Date,
): RepricingResolution {
  const first = firstInWindow(window, events, asOf, isRepricing);
  if (first !== undefined) return { status: "void", eventId: first.id, at: first.announcedAt };
  return afterGrace(window.cutoff, asOf) ? { status: "clear" } : { status: "open" };
}

export type NextRoundResolution =
  | { readonly status: "open" }
  | { readonly status: "round"; readonly eventId: string; readonly at: Date }
  | { readonly status: "void"; readonly reason: "no_print" }
  | { readonly status: "void"; readonly reason: "exit"; readonly eventId: string };

/**
 * RULEBOOK.contracts.next_round, for a contract that settles on a print: the
 * first priced round announced in (opensAt, cutoff], at any rank and with its
 * valuation disclosed or not. An acquisition or IPO before it voids (exit);
 * none by the cutoff and the observation grace voids (no_print). The round's
 * certificate is the settlement source; whether it gives a per-share price
 * for the new series (no_certificate) is the index's to say, not the events'.
 */
export function resolveNextRound(
  window: ContractWindow,
  events: readonly RulebookEvent[],
  asOf: Date,
): NextRoundResolution {
  const first = firstInWindow(
    window,
    events,
    asOf,
    (type) => type === "priced_round" || type === "acquisition" || type === "ipo",
  );
  if (first === undefined) {
    return afterGrace(window.cutoff, asOf)
      ? { status: "void", reason: "no_print" }
      : { status: "open" };
  }
  if (first.eventType !== "priced_round") {
    return { status: "void", reason: "exit", eventId: first.id };
  }
  return { status: "round", eventId: first.id, at: first.announcedAt };
}

/** One print as the rulebook stands it: the source that won its revision window. */
export interface Print {
  readonly eventId: string;
  /** The standing source's date. */
  readonly at: Date;
  /** The print's first report, which opens its revision window. */
  readonly firstAt: Date;
  readonly rank: PrintRank;
  readonly postMoneyUsd: number;
  /** False while a higher-ranked source could still supersede it. */
  readonly final: boolean;
}

/**
 * Every print announced at or before `asOf`, oldest first. A print opens on
 * its first report with a qualifying post-money; every qualifying report in
 * the revision window after it is a report of the same print, and the best
 * rank stands (the first among equals). A report after the window opens the
 * next print. A round whose valuation is undisclosed is not a print.
 */
export function resolvePrints(
  nameKind: NameKind,
  events: readonly RulebookEvent[],
  asOf: Date,
): readonly Print[] {
  validateEvents(events, asOf);
  const reports = events
    .filter(
      (event) =>
        event.postMoneyUsd !== null &&
        isPrint(event.eventType, nameKind) &&
        event.announcedAt <= asOf,
    )
    // Stable: reports at the same instant keep the order they were given.
    .sort((a, b) => a.announcedAt.getTime() - b.announcedAt.getTime());
  const prints: Print[] = [];
  let start = 0;
  while (start < reports.length) {
    const first = reports[start]!;
    const windowEnd = first.announcedAt.getTime() + RULEBOOK.revision_window_days * DAY_MS;
    let end = start;
    while (end < reports.length && reports[end]!.announcedAt.getTime() <= windowEnd) end += 1;
    const inWindow = reports.slice(start, end);
    const bestRank = Math.min(...inWindow.map((event) => event.rank));
    const standing = inWindow.find((event) => event.rank === bestRank)!;
    prints.push({
      eventId: standing.id,
      at: standing.announcedAt,
      firstAt: first.announcedAt,
      rank: standing.rank,
      postMoneyUsd: standing.postMoneyUsd!,
      // Nothing outranks rank 1, so a rank-1 print is final at once.
      final: bestRank === 1 || afterGrace(new Date(windowEnd), asOf),
    });
    start = end;
  }
  return prints;
}

/**
 * The print in force at `asOf`, or null. A print-settled contract reads the
 * next round's headline post-money from the print whose first report is that
 * round's announcement.
 */
export function lastPrint(
  nameKind: NameKind,
  events: readonly RulebookEvent[],
  asOf: Date,
): Print | null {
  return resolvePrints(nameKind, events, asOf).at(-1) ?? null;
}

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

export function afterGrace(deadline: Date, asOf: Date): boolean {
  assertDate(deadline, "deadline");
  assertDate(asOf, "asOf");
  return asOf.getTime() > deadline.getTime() + RULEBOOK.observation_grace_days * DAY_MS;
}

function earliest(events: readonly RulebookEvent[]): RulebookEvent | undefined {
  let first: RulebookEvent | undefined;
  for (const event of events) {
    if (first === undefined || event.announcedAt < first.announcedAt) first = event;
  }
  return first;
}

function validateEvents(events: readonly RulebookEvent[], asOf: Date): void {
  assertDate(asOf, "asOf");
  for (const event of events) assertDate(event.announcedAt, "announcedAt");
}
