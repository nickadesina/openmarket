import type { EventFlagConfidence, QuoteFlagState, QuoteReason } from "../db/schema.js";
import { FLAG_KINDS } from "../engine/dealer/lifecycle.js";
import type { RefFlag, RefFlagsPayload } from "../services/dealer/ref-flags.js";
import type {
  RefHistoryPayload,
  RefHistoryQuote,
  RefHistoryReference,
} from "../services/dealer/ref-history.js";
import type { RefListingSummary, RefListingsPayload } from "../services/dealer/ref-listings.js";
import type { RefMid, RefMidsPayload } from "../services/dealer/ref-mids.js";
import type {
  RefForwardReference,
  RefHazardReference,
  RefReferencePayload,
} from "../services/dealer/ref-reference.js";

/**
 * The /ref docs page's content that is not prose: each route's fields,
 * checked against the payload types so a field added to a payload fails the
 * typecheck until it is documented here, and the keys the page and
 * docs/tradeables/ref-examples.json never show.
 *
 * Withheld: the dealer's parameters, the blend's weights and schedule, a
 * mid's inputs and a quote's spread and cap carry the construction the
 * tradeables brief keeps off every page (b, Q, κ, p_floor, s_floor, the
 * flag multipliers, λ, k, μ, σ_tier, the leak hazards, the blend weights).
 */
export const WITHHELD_KEYS = [
  "parameters",
  "blend",
  "weights",
  "components",
  "inputs",
  "half_spread",
  "cap_usd_effective",
] as const;

type Withheld = (typeof WITHHELD_KEYS)[number];

/** One line per field, keyed by the payload type's own keys minus the withheld ones. */
type FieldDocs<T> = { readonly [K in Exclude<keyof T, Withheld>]-?: string };

export const ENVELOPE_FIELDS = {
  model_version:
    "The prior's formulas and the backtest parameters that produced the figures, as semver. A rerun of the backtest that changes a parameter is a new version.",
  rulebook_version:
    "The settlement rulebook in force (/rulebook). A changed rule is a new version.",
  blend_version:
    "The published schedule by which model, traded price and crowd are weighted. A changed weight is a new version.",
  as_of: "When the server answered, UTC.",
} as const;

/** Every member of a string union, checked exhaustive by the compiler. */
function members<T extends string>(all: Record<T, true>): string {
  return Object.keys(all).join(", ");
}

const QUOTE_REASONS = members<QuoteReason>({
  list: true,
  requote: true,
  fill: true,
  widen: true,
  restore: true,
});
const FLAG_STATES = members<QuoteFlagState>({ normal: true, widened: true });
const CONFIDENCES = members<EventFlagConfidence>({ high: true, medium: true, low: true });

export interface RouteDoc {
  readonly path: string;
  readonly query: readonly (readonly [string, string])[];
  readonly summary: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly items?: { readonly name: string; readonly fields: Readonly<Record<string, string>> };
  readonly example: string;
}

const listing = {
  slug: "The name's slug, used in every other route.",
  name: "The company's name.",
  tier: "mega or redhot, by the last print (at or above $10B is mega).",
  binary_event: "What resolves the binary: priced_round, or public_s1 for the labs.",
  listed_at: "When the listing was made.",
  listing_model_version: "The model version the listing was made under.",
  forward_t_days: "The forward's expiry in days from each open, a contract term.",
  anchor:
    "The last priced round the listing is anchored on: round, date, post-money, source URL and rank.",
  instruments:
    "The live binary and forward: id, kind, epoch, question, state, open, expiry, widening.",
} as const satisfies FieldDocs<RefListingSummary>;

const reference = {
  instrument_id: "The instrument the reference is for.",
  as_of: "When this reference row was published.",
  blend_version: "The blend schedule the row was computed under.",
  model_version: "The model version of the mid it blends.",
  rulebook_version: "The rulebook version in force when it was published.",
  model_only:
    "True when no traded price and no crowd enter the blend: the reference is the model mid and says so.",
} as const;

const forwardReference = {
  ...reference,
  ln: "The forward's reference level, natural log of USD.",
  usd: "The same level in dollars.",
} as const satisfies FieldDocs<RefForwardReference>;

const hazardReference = {
  ...reference,
  p: "The binary's reference probability of the event by its expiry.",
} as const satisfies FieldDocs<RefHazardReference>;

const referencePayload = {
  ...ENVELOPE_FIELDS,
  slug: "The name's slug.",
  name: "The company's name.",
  tier: "mega or redhot.",
  reference_forward: `The forward's reference: ${Object.keys(forwardReference).join(", ")}. Null before the first publish.`,
  reference_hazard: `The binary's reference: ${Object.keys(hazardReference).join(", ")}. Null before the first publish.`,
  last_print:
    "The latest print: round, date, post-money in USD and ln, source URL and rank, and the flag it came from.",
  next_expiry: "The live instrument that expires first: kind, id, expiry.",
  dealer_inventory_sign:
    "The sign of the dealer's forward inventory (-1, 0, 1), never its size; null with no live forward.",
  instruments: "Each live instrument with its tournament question's slug.",
} as const satisfies FieldDocs<RefReferencePayload>;

const historyReference = {
  id: "The reference row's id.",
  kind: "forward or binary.",
  as_of: "When the row was published.",
  value: "ln USD for a forward, the probability for a binary.",
  usd: "A forward's value in dollars; null for a binary.",
  blend_version: "The blend schedule the row was computed under.",
  model_version: "The model version of the mid it blends.",
  rulebook_version: "The rulebook version in force.",
} as const satisfies FieldDocs<RefHistoryReference>;

const historyQuote = {
  sequence: "The quote's position on the tape.",
  instrument_id: "The instrument quoted.",
  kind: "forward or binary.",
  epoch: "The instrument's epoch for this name and kind.",
  posted_at: "When the quote was posted.",
  reason: `Why it was posted: ${QUOTE_REASONS}.`,
  model_mid_id: "The model mid it was quoted around.",
  mid_ln: "The forward's quote mid, ln USD.",
  mid_usd: "The same in dollars.",
  bid_ln: "The forward's bid, ln USD; null when that side is pulled.",
  bid_usd: "The same in dollars.",
  ask_ln: "The forward's ask, ln USD; null when that side is pulled.",
  ask_usd: "The same in dollars.",
  price: "The binary's YES price.",
  dealer_inventory_sign: "The sign of the dealer's inventory after the quote.",
  flag_state: `${FLAG_STATES}: widened while an event flag holds.`,
  model_version: "The model version of the mid quoted around.",
  rulebook_version: "The rulebook version in force.",
} as const satisfies FieldDocs<RefHistoryQuote>;

const mid = {
  id: "The mid's id; references and quotes cite it.",
  instrument_id: "The instrument the mid is for.",
  kind: "forward or binary.",
  epoch: "The instrument's epoch.",
  computed_at: "When the model computed it.",
  model_version: "The model version that computed it.",
  rulebook_version: "The rulebook version in force.",
  mid_ln: "A forward's mid, ln USD.",
  mid_usd: "The same in dollars.",
  p: "A binary's model probability.",
  run_id: "The dealer run that wrote it.",
} as const satisfies FieldDocs<RefMid>;

const flag = {
  id: "The flag's id; mids that moved on it cite it.",
  kind: `What was observed: ${FLAG_KINDS.join(", ")}.`,
  source_url: "Where it was observed.",
  source_rank: "Its rank in the rulebook's source hierarchy, when it has one.",
  observed_at: "When it was observed.",
  published_at: "When the source published it, when known.",
  terms: "The terms as extracted: amount, valuation and basis, lead, price per share, outlet.",
  confidence: `How sure the extraction is: ${CONFIDENCES}.`,
  dedupe_key: "The key that makes one event one flag.",
  promoted_from: "The flag this print was promoted from, if any.",
  cited_by_mids: "The ids of mids that cite this flag.",
} as const satisfies FieldDocs<RefFlag>;

const cursorQuery = [
  ["limit", "1 to 1000, default 200."],
  ["cursor", "next_cursor from the previous page."],
] as const;

export const REF_ROUTES: readonly RouteDoc[] = [
  {
    path: "/api/ref/listings",
    query: [],
    summary: "Every listed name with its tier, contract terms, anchor round and live instruments.",
    fields: {
      ...ENVELOPE_FIELDS,
      listings: "One entry per listed name.",
    } satisfies FieldDocs<RefListingsPayload>,
    items: { name: "listings[]", fields: listing },
    example: "listings",
  },
  {
    path: "/api/ref/{slug}",
    query: [],
    summary:
      "A name's current reference price for both contracts, its last print, its next expiry and the dealer's inventory sign.",
    fields: referencePayload,
    example: "reference",
  },
  {
    path: "/api/ref/{slug}/history",
    query: [
      ["from", "ISO 8601 instant; the window's start."],
      ["to", "ISO 8601 instant; the window's end, default now."],
      ...cursorQuery,
    ],
    summary: "Every published reference row and every dealer quote for a name, newest first.",
    fields: {
      ...ENVELOPE_FIELDS,
      slug: "The name's slug.",
      from: "The window's start, or null.",
      to: "The window's end.",
      references: "Published reference rows.",
      quotes: "The dealer's quote tape.",
      next_cursor: "Pass as cursor for the next page; null on the last.",
    } satisfies FieldDocs<RefHistoryPayload>,
    items: { name: "references[]", fields: historyReference },
    example: "history",
  },
  {
    path: "/api/ref/{slug}/mids",
    query: cursorQuery,
    summary: "The model's forecast log for a name: every mid it published, newest first.",
    fields: {
      ...ENVELOPE_FIELDS,
      slug: "The name's slug.",
      mids: "The model's mids.",
      next_cursor: "Pass as cursor for the next page; null on the last.",
    } satisfies FieldDocs<RefMidsPayload>,
    items: { name: "mids[]", fields: mid },
    example: "mids",
  },
  {
    path: "/api/ref/{slug}/flags",
    query: cursorQuery,
    summary: "The events observed for a name and the mids that moved on them, newest first.",
    fields: {
      ...ENVELOPE_FIELDS,
      slug: "The name's slug.",
      flags: "Observed events.",
      next_cursor: "Pass as cursor for the next page; null on the last.",
    } satisfies FieldDocs<RefFlagsPayload>,
    items: { name: "flags[]", fields: flag },
    example: "flags",
  },
  {
    path: "/api/ref/rulebook",
    query: [],
    summary:
      "The settlement rulebook as data, with the rules not yet enforced. In prose at /rulebook.",
    fields: {
      ...ENVELOPE_FIELDS,
      rulebook:
        "The rules: print, announcement, source ranks, revision, the binary's and the forward's.",
      not_built: "Rules that are the contract's intent but not enforced by the code yet.",
    },
    example: "rulebook",
  },
];

export const QUOTE_FIELDS = historyQuote;

/** A copy of `value` with every withheld key removed, at any depth. */
export function withholdKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withholdKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !(WITHHELD_KEYS as readonly string[]).includes(key))
        .map(([key, child]) => [key, withholdKeys(child)]),
    );
  }
  return value;
}

/** The first `count` entries of every array, so an example stays readable. */
export function firstEntries(value: unknown, count: number): unknown {
  if (Array.isArray(value)) return value.slice(0, count).map((item) => firstEntries(item, count));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, firstEntries(child, count)]),
    );
  }
  return value;
}
