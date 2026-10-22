import type { Kysely, Transaction } from "kysely";

import type { QuestionInput, ResolveQuestionInput } from "../../api/tournament-schemas.js";
import type {
  Database,
  InstrumentRow,
  JsonObject,
  ListingRow,
  TournamentQuestionKind,
  TournamentQuestionStatus,
  TournamentUnit,
} from "../../db/schema.js";
import { RULEBOOK, RULEBOOK_VERSION } from "../../engine/dealer/rulebook.js";
import {
  closeQuestionIn,
  openQuestionIn,
  resolveQuestionIn,
  saveDraftQuestionIn,
  voidQuestionIn,
} from "../tournament/admin.js";
import { effectiveStatus, requireQuestion, windowEnd } from "../tournament/records.js";

/**
 * The tournament bridge (milestone 7, CONTRACTS.md → Tournament mapping,
 * TECHNICAL_DESIGN.md §7, decision 0004). A mapping, not a mechanism: every
 * instrument the dealer lists gets a tournament question created and opened
 * through the tournament's own services in the listing's transaction, and
 * the settle job resolves (or voids) it through them in the settlement's
 * transaction.
 *
 * - Binary → a `binary` question (one probability of YES) closing at the
 *   binary's expiry. It resolves YES or NO with the binary.
 * - Forward → a `forward` question (one level) in USD_T when the
 *   instrument's listing mid (its first `model_mids` row) is $1T or more,
 *   else USD_B, closing and expiring at the forward's expiry. It resolves to
 *   the settling post-money in that unit; a forward that voids voids its
 *   question, which writes no scores.
 * - A question opens at the listing's clock, so a rolled binary listed at
 *   its predecessor's announcement opens its question when the roll runs.
 * - Resolution: the scoring window is back-dated to the settling
 *   announcement's public time (never before the question opened), and the
 *   rung recorded is the source rank of the flag that settled it (1–4,
 *   CONTRACTS.md → Settlement hierarchy), the nearest thing the dealer's
 *   rulebook has to the tournament's figure hierarchy. A NO has no
 *   resolution document and no rung.
 */

const SLUG_MAX = 100;

/** A stored forward resolution must equal the settlement's post-money in its unit this closely (relative). */
const VALUE_TOLERANCE = 1e-12;

export interface LinkedQuestion {
  readonly question_id: string;
  readonly slug: string;
}

type BridgeListing = Pick<ListingRow, "binary_event"> & {
  readonly company: { readonly name: string; readonly slug: string };
};

type BridgeInstrument = Pick<InstrumentRow, "id" | "kind" | "epoch" | "question" | "expires_at">;

/** The linked question's shape, as the bridge resolves and verifies it. */
export interface LinkedQuestionShape {
  readonly kind: TournamentQuestionKind;
  readonly unit: TournamentUnit | null;
}

function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** USD per one of a forward question's units. */
export const UNIT_USD: Readonly<Record<TournamentUnit, number>> = Object.freeze({
  USD_B: 1e9,
  USD_T: 1e12,
});

/** A forward question's unit from its instrument's listing mid in USD: USD_T from $1T up. */
export function forwardQuestionUnit(midUsd: number): TournamentUnit {
  if (!Number.isFinite(midUsd) || midUsd <= 0) throw new RangeError("midUsd must be positive");
  return midUsd >= UNIT_USD.USD_T ? "USD_T" : "USD_B";
}

/** A value in USD as a value in the question's unit. */
export function inQuestionUnit(valueUsd: number, unit: TournamentUnit): number {
  return valueUsd / UNIT_USD[unit];
}

function unitWords(unit: TournamentUnit): string {
  return unit === "USD_T" ? "USD trillions" : "USD billions";
}

/** The question's integer rulebook version: the dealer rulebook's major version. */
export function questionRulebookVersion(version: string = RULEBOOK_VERSION): number {
  return Number(version.split(".")[0]);
}

function sourceRanks(): string {
  return RULEBOOK.source_ranks.map((row) => `${row.rank}. ${row.source}`).join("\n");
}

function binaryRulebook(listing: BridgeListing): string {
  const binary = RULEBOOK.binary;
  return [
    `**OpenMarket rulebook ${RULEBOOK_VERSION}**, published at /api/ref/rulebook. This question resolves with the dealer's binary, in the same transaction.`,
    `**Yes:** ${binary.resolves_yes} ${binary.window}`,
    `**No:** ${binary.resolves_no}`,
    listing.binary_event === "public_s1" ? binary.labs : binary.undisclosed_valuation,
    `An announcement is ${RULEBOOK.announcement.charAt(0).toLowerCase()}${RULEBOOK.announcement.slice(1)}`,
    `**Sources, highest rank first** (the rank is recorded as the rung):\n${sourceRanks()}`,
    "The scoring window ends at the qualifying announcement's public time.",
  ].join("\n\n");
}

function forwardRulebook(unit: TournamentUnit): string {
  const forward = RULEBOOK.forward;
  return [
    `**OpenMarket rulebook ${RULEBOOK_VERSION}**, published at /api/ref/rulebook. This question resolves with the dealer's forward, in the same transaction.`,
    `**Print:** ${RULEBOOK.print.definition} ${RULEBOOK.print.conversions.join(" ")}`,
    `**Resolves** to the post-money in ${unitWords(unit)} ${forward.settles.charAt(0).toLowerCase()}${forward.settles.slice(1)} ${forward.down_rounds}`,
    `**Void:** ${forward.void} ${forward.undisclosed_valuation} ${forward.acquisition} A void voids this question, and nothing is scored.`,
    `**Sources, highest rank first** (the rank is recorded as the rung):\n${sourceRanks()}`,
    "The scoring window ends at the settling print's public time.",
  ].join("\n\n");
}

/**
 * The question a just-listed instrument asks the tournament, before its slug
 * is made unique. `unit` is a forward's (forwardQuestionUnit); null for a
 * binary.
 */
export function linkedQuestionInput(
  listing: BridgeListing,
  instrument: BridgeInstrument,
  unit: TournamentUnit | null,
  opensAt: Date,
  slug: string,
): QuestionInput {
  const expiry = instrument.expires_at.toISOString();
  const common = {
    slug,
    title: instrument.question,
    rulebook_version: questionRulebookVersion(),
    opens_at: opensAt.toISOString(),
    closes_at: expiry,
  };
  const name = listing.company.name;
  if (instrument.kind === "binary") {
    return {
      ...common,
      kind: "binary",
      description_md: `Linked to ${name}'s quarterly binary on OpenMarket (epoch ${instrument.epoch}), which expires ${isoDay(instrument.expires_at)}. The crowd's P(Yes) enters the published reference hazard from ten forecasters.`,
      rulebook_md: binaryRulebook(listing),
    };
  }
  if (unit === null) throw new RangeError("a forward's question needs its unit");
  return {
    ...common,
    kind: "forward",
    unit,
    expiry_at: expiry,
    description_md: `${name}'s next post-money in ${unitWords(unit)}, linked to its next-print forward on OpenMarket (epoch ${instrument.epoch}), which expires ${isoDay(instrument.expires_at)}. If the forward voids, so does this question. The crowd's median enters the published reference forward from ten forecasters.`,
    rulebook_md: forwardRulebook(unit),
  };
}

function baseSlug(listing: BridgeListing, instrument: BridgeInstrument): string {
  const what =
    instrument.kind === "forward"
      ? "next-print"
      : listing.binary_event === "public_s1"
        ? "s1"
        : "round";
  return `${listing.company.slug}-${what}-by-${isoDay(instrument.expires_at)}`.slice(
    0,
    SLUG_MAX - 4,
  );
}

/** The base slug, or the first free `-2`, `-3`, … after it. */
async function uniqueSlug(db: Transaction<Database>, base: string): Promise<string> {
  const taken = new Set(
    (
      await db
        .selectFrom("tournament_questions")
        .select("slug")
        .where((eb) => eb.or([eb("slug", "=", base), eb("slug", "like", `${base}-%`)]))
        .execute()
    ).map((row) => row.slug),
  );
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A forward question's unit from its listing mid: the instrument's first `model_mids` row. */
async function forwardUnitOf(
  db: Transaction<Database>,
  instrumentId: string,
): Promise<TournamentUnit> {
  const first = await db
    .selectFrom("model_mids")
    .select("mid_ln")
    .where("instrument_id", "=", instrumentId)
    .orderBy("computed_at")
    .orderBy("id")
    .executeTakeFirst();
  if (first?.mid_ln == null) throw new RangeError(`forward ${instrumentId} has no listing mid`);
  return forwardQuestionUnit(Math.exp(first.mid_ln));
}

/**
 * Creates, opens and links the instrument's question in the caller's
 * transaction, once the instrument has its first mid. Null, writing nothing,
 * when the instrument is already past its expiry at `now` (a roll that ran
 * too late leaves nothing to forecast).
 */
export async function linkInstrumentQuestion(
  db: Transaction<Database>,
  input: {
    readonly listing: BridgeListing;
    readonly instrument: BridgeInstrument;
    readonly now: Date;
  },
): Promise<LinkedQuestion | null> {
  const { listing, instrument, now } = input;
  if (now.getTime() >= instrument.expires_at.getTime()) return null;
  const unit = instrument.kind === "forward" ? await forwardUnitOf(db, instrument.id) : null;
  const slug = await uniqueSlug(db, baseSlug(listing, instrument));
  await saveDraftQuestionIn(db, linkedQuestionInput(listing, instrument, unit, now, slug));
  await openQuestionIn(db, slug, now);
  const question = await db
    .selectFrom("tournament_questions")
    .select("id")
    .where("slug", "=", slug)
    .executeTakeFirstOrThrow();
  await db
    .insertInto("tournament_instrument_links")
    .values({ question_id: question.id, instrument_id: instrument.id })
    .execute();
  return { question_id: question.id, slug };
}

/** How an instrument ended, as its linked question needs it. */
export type InstrumentEnding =
  | {
      readonly kind: "binary_yes";
      readonly at: Date;
      readonly rank: number | null;
      readonly sourceUrl: string | null;
    }
  | { readonly kind: "binary_no" }
  | {
      readonly kind: "forward_settled";
      readonly at: Date;
      readonly rank: number;
      readonly sourceUrl: string | null;
      readonly postMoneyUsd: number;
      readonly final: boolean;
    }
  | { readonly kind: "forward_void" };

/** How the instrument ended, from its settlement's own record, for the linked question. */
export function instrumentEnding(result: JsonObject): InstrumentEnding {
  const at = typeof result.announced_at === "string" ? new Date(result.announced_at) : null;
  const rank = typeof result.source_rank === "number" ? result.source_rank : null;
  const sourceUrl = typeof result.source_url === "string" ? result.source_url : null;
  switch (result.outcome) {
    case "yes":
      return { kind: "binary_yes", at: at!, rank, sourceUrl };
    case "no":
      return { kind: "binary_no" };
    case "settled": {
      const postMoney =
        typeof result.post_money_usd === "number"
          ? result.post_money_usd
          : Math.exp(result.settle_ln as number);
      return {
        kind: "forward_settled",
        at: at!,
        rank: rank!,
        sourceUrl,
        postMoneyUsd: postMoney,
        final: result.final === true,
      };
    }
    default:
      return { kind: "forward_void" };
  }
}

/** What a linked question resolves to: a binary's outcome, or a forward's value in its unit. */
export type QuestionResult =
  | { readonly outcome: "yes" | "no" }
  | { readonly resolved_value: number };

/** The resolution an ending implies on its question; null for a void or a kind mismatch. */
export function expectedResolution(
  ending: InstrumentEnding,
  question: LinkedQuestionShape,
): QuestionResult | null {
  switch (ending.kind) {
    case "binary_yes":
      return question.kind === "binary" ? { outcome: "yes" } : null;
    case "binary_no":
      return question.kind === "binary" ? { outcome: "no" } : null;
    case "forward_settled":
      return question.kind === "forward" && question.unit !== null
        ? { resolved_value: inQuestionUnit(ending.postMoneyUsd, question.unit) }
        : null;
    case "forward_void":
      return null;
  }
}

export type LinkedResolution =
  | ({ readonly slug: string; readonly status: "resolved" } & QuestionResult)
  | { readonly slug: string; readonly status: "voided" }
  | { readonly slug: string; readonly status: "skipped"; readonly reason: string };

function resolutionInput(
  ending: Exclude<InstrumentEnding, { kind: "forward_void" }>,
  result: QuestionResult,
  note: string,
): ResolveQuestionInput {
  const sourced = ending.kind === "binary_no" ? null : ending;
  return {
    ...result,
    rung_fired: sourced?.rank ?? null,
    source_url: sourced?.sourceUrl ?? null,
    source_excerpt: null,
    note_md: note,
  };
}

function resolutionNote(ending: InstrumentEnding, runId: string): string {
  const run = `the settle job (run ${runId}), rulebook ${RULEBOOK_VERSION}`;
  switch (ending.kind) {
    case "binary_yes":
      return `Yes: the qualifying announcement of ${isoDay(ending.at)} (source rank ${ending.rank ?? "unknown"}), resolved by ${run}.`;
    case "binary_no":
      return `No: no qualifying announcement by expiry, resolved by ${run}.`;
    case "forward_settled":
      return `The rank ${ending.rank} print of ${isoDay(ending.at)}, resolved by ${run}.${ending.final ? "" : " Provisional: a higher-ranked source inside the revision window may supersede it."}`;
    case "forward_void":
      return `Voided with the forward: no qualifying print by expiry, by ${run}. Unscored.`;
  }
}

const UNRESOLVABLE: readonly TournamentQuestionStatus[] = ["draft", "resolved", "voided"];

/**
 * Resolves or voids the instrument's linked question in the caller's (the
 * settlement's) transaction; null when the instrument has no link. A
 * question an admin already resolved or voided is left as it stands.
 */
export async function resolveLinkedQuestion(
  db: Transaction<Database>,
  instrumentId: string,
  ending: InstrumentEnding,
  runId: string,
  now: Date,
): Promise<LinkedResolution | null> {
  const link = await db
    .selectFrom("tournament_instrument_links")
    .innerJoin(
      "tournament_questions",
      "tournament_questions.id",
      "tournament_instrument_links.question_id",
    )
    .select(["tournament_questions.slug", "tournament_questions.kind", "tournament_questions.unit"])
    .where("tournament_instrument_links.instrument_id", "=", instrumentId)
    .executeTakeFirst();
  if (link === undefined) return null;
  const { slug } = link;
  const question = await requireQuestion(db, slug, { includeDrafts: true, forUpdate: true });
  if (UNRESOLVABLE.includes(question.storedStatus)) {
    return { slug, status: "skipped", reason: `the question is ${question.storedStatus}` };
  }
  const note = resolutionNote(ending, runId);
  if (ending.kind === "forward_void") {
    await voidQuestionIn(db, slug, { note_md: note });
    return { slug, status: "voided" };
  }
  const result = expectedResolution(ending, link);
  if (result === null) throw new RangeError(`question ${slug} cannot take this outcome`);

  if (ending.kind !== "binary_no") {
    // The window ends at the document's public time, never before the question opened.
    const closeAt = new Date(Math.max(ending.at.getTime(), question.opensAt.getTime()));
    if (closeAt.getTime() < windowEnd(question).getTime()) {
      await closeQuestionIn(
        db,
        slug,
        { closed_at: closeAt.toISOString() },
        { at: now, afterScheduledClose: true },
      );
    }
  } else if (effectiveStatus(question, now) === "open") {
    await closeQuestionIn(db, slug, {}, { at: now });
  }

  await resolveQuestionIn(
    db,
    slug,
    resolutionInput(ending, result, note),
    { settleRunId: runId },
    now,
  );
  return { slug, status: "resolved", ...result };
}

/** Whether a stored resolution says what the settlement implies. */
function carriesResult(
  stored: { readonly outcome: "yes" | "no" | null; readonly resolved_value: string | null },
  expected: QuestionResult,
): boolean {
  if ("outcome" in expected) {
    return stored.outcome === expected.outcome && stored.resolved_value === null;
  }
  if (stored.outcome !== null || stored.resolved_value === null) return false;
  const value = Number(stored.resolved_value);
  return (
    Math.abs(value - expected.resolved_value) <=
    VALUE_TOLERANCE * Math.max(1, Math.abs(expected.resolved_value))
  );
}

function describeResult(result: QuestionResult | null): string {
  if (result === null) return "no resolution";
  return "outcome" in result ? `outcome ${result.outcome}` : `value ${result.resolved_value}`;
}

export interface BridgeFinding {
  readonly id: string;
  readonly detail: string;
}

/**
 * verify:replay's bridge half: every closed instrument whose settlement
 * resolved or voided its linked question left that question so, and the
 * settle run's resolution (the first, before any dispute superseded it)
 * carries the outcome, or the value in the question's unit, that the
 * instrument's own settlement implies.
 */
export async function verifyLinkedQuestions(
  db: Kysely<Database>,
): Promise<{ readonly checked: number; readonly findings: BridgeFinding[] }> {
  const rows = await db
    .selectFrom("tournament_instrument_links as links")
    .innerJoin("instruments", "instruments.id", "links.instrument_id")
    .innerJoin("tournament_questions as questions", "questions.id", "links.question_id")
    .select([
      "links.id",
      "instruments.resolution_json",
      "questions.id as question_id",
      "questions.status",
      "questions.kind",
      "questions.unit",
    ])
    .where("instruments.state", "in", ["resolved", "expired"])
    .orderBy("links.id")
    .execute();
  const findings: BridgeFinding[] = [];
  for (const row of rows) {
    const record = row.resolution_json;
    if (record === null || typeof record !== "object" || Array.isArray(record)) continue;
    const linked = record.question;
    if (linked === null || typeof linked !== "object" || Array.isArray(linked)) continue;
    const fail = (detail: string) => findings.push({ id: row.id, detail });
    if (linked.status === "voided" && row.status !== "voided") {
      fail(`the settlement voided question ${row.question_id}; it is ${row.status}`);
    }
    if (linked.status !== "resolved") continue;
    const first = await db
      .selectFrom("tournament_resolutions")
      .select(["outcome", "resolved_value", "settle_run_id"])
      .where("question_id", "=", row.question_id)
      .orderBy("resolved_at")
      .orderBy("id")
      .executeTakeFirst();
    const expected = expectedResolution(instrumentEnding(record), row);
    if (
      row.status !== "resolved" ||
      first === undefined ||
      first.settle_run_id === null ||
      expected === null ||
      !carriesResult(first, expected)
    ) {
      fail(
        `question ${row.question_id} does not carry the settlement's ${describeResult(expected)}`,
      );
    }
  }
  return { checked: rows.length, findings };
}
