import { createHash } from "node:crypto";

import { type Kysely, sql, type Transaction } from "kysely";

import { DEALER_PARAMS, MODEL_VERSION } from "../../config/dealer.js";
import type {
  BinaryEventKind,
  Database,
  EventFlagRow,
  InstrumentRow,
  JsonObject,
  MarketRow,
} from "../../db/schema.js";
import { settlementCreditCents, voidCreditCents } from "../../engine/dealer/forward.js";
import {
  type InstrumentSnapshot,
  type LifecycleEffect,
  transition,
} from "../../engine/dealer/lifecycle.js";
import {
  type BinaryResolution,
  type FlagTerms,
  type ForwardResolution,
  postMoneyUsd,
  RULEBOOK,
  RULEBOOK_VERSION,
  type RulebookEvent,
  resolveBinary,
  resolveForward,
  type SourceRank,
} from "../../engine/dealer/rulebook.js";
import { beginCronRun, type CronRunOutcome, finishCronRun } from "./cron-run.js";
import { LIVE_STATES, latestMid, RULEBOOK_SOURCE_URL } from "./dealer-books.js";
import { type ListingWithCompany, listInstrument } from "./list-instruments.js";
import { settleLmsrBook } from "./settle-lmsr-book.js";

/**
 * /api/cron/settle (TECHNICAL_DESIGN.md §6, §9): every live instrument in its
 * own transaction, which
 *
 *  (a) promotes the name's `release` and `s1_public` flags that carry a
 *      post-money, at high confidence and source rank 1–2, to `print` rows
 *      (rank 3–4 is reported as pending, for the admin queue);
 *  (b) puts the flags in front of the rulebook: a print is a priced round
 *      (an IPO when promoted from an S-1) with its post-money; a qualifying
 *      release is a priced-round announcement for the binary even with the
 *      valuation undisclosed; a public S-1 is the labs' binary event; a
 *      scoop never resolves;
 *  (c) on resolution, or once T plus the observation grace has passed,
 *      pays the binary $1 a winning share or settles the forward's
 *      positions at forward.ts's credit (voids refund the collateral), and
 *      closes the book and the instrument;
 *  (d) lists the successor in that same transaction.
 *
 * A forward settled while a higher-ranked source could still supersede it
 * is recorded with `final: false`; a correcting settlement is a follow-up.
 */

const PROMOTABLE_KINDS = ["release", "s1_public"] as const;
const RESOLVING_KINDS = ["print", "release", "s1_public"] as const;

export interface PendingPromotion {
  readonly flag_id: string;
  readonly company: string;
  readonly kind: string;
  readonly source_rank: number | null;
  readonly confidence: string;
  readonly reason: "rank_needs_review" | "confidence_below_high" | "no_source_url";
}

export interface InstrumentOutcome {
  readonly instrument_id: string;
  readonly company: string;
  readonly kind: InstrumentRow["kind"];
  readonly outcome: "open" | "yes" | "no" | "settled" | "void" | "skipped";
  readonly final?: boolean;
  readonly successor_instrument_id?: string | null;
}

export interface SettleRunSummary {
  readonly run_id: string;
  readonly instruments: number;
  readonly resolved: number;
  readonly outcomes: readonly InstrumentOutcome[];
  readonly promoted: readonly string[];
  readonly pending: readonly PendingPromotion[];
}

export type SettleJobOutcome = CronRunOutcome<SettleRunSummary>;

function flagTime(flag: Pick<EventFlagRow, "published_at" | "observed_at">): Date {
  return flag.published_at ?? flag.observed_at;
}

function postMoneyOf(terms: JsonObject): number | null {
  return postMoneyUsd(terms as unknown as FlagTerms);
}

/** The fixture's print key: sha256 of company|print|date|post-money, first 16 hex. */
function printDedupeKey(slug: string, at: Date, postMoney: number): string {
  const parts = [slug, "print", at.toISOString().slice(0, 10), String(postMoney)];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function pendingReason(flag: EventFlagRow): PendingPromotion["reason"] | null {
  if (flag.confidence !== "high") return "confidence_below_high";
  if (flag.source_rank === null || flag.source_rank > RULEBOOK.review.auto_resolve_max_rank) {
    return "rank_needs_review";
  }
  if (flag.source_url === null) return "no_source_url";
  return null;
}

/** (a) Promotes the company's qualifying releases and S-1s to prints; reports the rest. */
async function promoteFlags(
  db: Transaction<Database>,
  listing: ListingWithCompany,
  runId: string,
  now: Date,
): Promise<{ promoted: string[]; pending: PendingPromotion[] }> {
  const candidates = await db
    .selectFrom("event_flags")
    .selectAll()
    .where("company_id", "=", listing.company_id)
    .where("kind", "in", PROMOTABLE_KINDS)
    .where("observed_at", "<=", now)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("event_flags as print")
            .select("print.id")
            .whereRef("print.promoted_from", "=", "event_flags.id"),
        ),
      ),
    )
    .orderBy("observed_at")
    .orderBy("id")
    .execute();
  const promoted: string[] = [];
  const pending: PendingPromotion[] = [];
  for (const flag of candidates) {
    const postMoney = postMoneyOf(flag.terms_json);
    if (postMoney === null) continue;
    const reason = pendingReason(flag);
    if (reason !== null) {
      pending.push({
        flag_id: flag.id,
        company: listing.company.name,
        kind: flag.kind,
        source_rank: flag.source_rank,
        confidence: flag.confidence,
        reason,
      });
      continue;
    }
    const print = await db
      .insertInto("event_flags")
      .values({
        company_id: flag.company_id,
        kind: "print",
        source_url: flag.source_url,
        source_rank: flag.source_rank,
        observed_at: now,
        published_at: flag.published_at,
        terms_json: flag.terms_json,
        confidence: flag.confidence,
        dedupe_key: printDedupeKey(listing.company.slug, flagTime(flag), postMoney),
        promoted_from: flag.id,
        run_id: runId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    promoted.push(print.id);
  }
  return { promoted, pending };
}

type ResolvingFlag = EventFlagRow & { readonly promoted_from_kind: string | null };

async function resolvingFlags(
  db: Transaction<Database>,
  companyId: string,
  now: Date,
): Promise<ResolvingFlag[]> {
  return db
    .selectFrom("event_flags")
    .leftJoin("event_flags as source", "source.id", "event_flags.promoted_from")
    .selectAll("event_flags")
    .select("source.kind as promoted_from_kind")
    .where("event_flags.company_id", "=", companyId)
    .where("event_flags.kind", "in", RESOLVING_KINDS)
    .where("event_flags.observed_at", "<=", now)
    .execute();
}

function qualifiesUnreviewed(flag: EventFlagRow): boolean {
  return (
    flag.confidence === "high" &&
    flag.source_rank !== null &&
    flag.source_rank <= RULEBOOK.review.auto_resolve_max_rank
  );
}

/** (b) The flags as rulebook events, for one kind of instrument. */
export function rulebookEvents(
  kind: InstrumentRow["kind"],
  flags: readonly ResolvingFlag[],
): RulebookEvent[] {
  const events: RulebookEvent[] = [];
  for (const flag of flags) {
    const base = {
      id: flag.id,
      announcedAt: flagTime(flag),
      postMoneyUsd: postMoneyOf(flag.terms_json),
    };
    if (flag.kind === "print" && flag.source_rank !== null) {
      const eventType = flag.promoted_from_kind === "s1_public" ? "ipo" : "priced_round";
      events.push({ ...base, eventType, rank: flag.source_rank as SourceRank });
    } else if (
      kind === "binary" &&
      (flag.kind === "release" || flag.kind === "s1_public") &&
      qualifiesUnreviewed(flag)
    ) {
      const eventType = flag.kind === "s1_public" ? "public_s1" : "priced_round";
      events.push({ ...base, eventType, rank: flag.source_rank as SourceRank });
    }
  }
  return events;
}

function resolve(
  instrument: InstrumentRow,
  binaryEvent: BinaryEventKind,
  flags: readonly ResolvingFlag[],
  now: Date,
): BinaryResolution | ForwardResolution {
  const events = rulebookEvents(instrument.kind, flags);
  return instrument.kind === "binary"
    ? resolveBinary(
        { binaryEvent, opensAt: instrument.opens_at, cutoff: instrument.expires_at },
        events,
        now,
      )
    : resolveForward(
        { binaryEvent, opensAt: instrument.opens_at, expiresAt: instrument.expires_at },
        events,
        now,
      );
}

/** The terminal transition, from the rulebook's resolution or, failing that, the clock. */
function terminalEffects(
  instrument: InstrumentRow,
  resolution: BinaryResolution | ForwardResolution,
  now: Date,
  flagHours: number,
): { state: "resolved" | "expired"; effects: readonly LifecycleEffect[] } | null {
  const until = instrument.state === "widened" ? instrument.widened_until : null;
  const snapshot: InstrumentSnapshot = {
    kind: instrument.kind,
    state: instrument.state,
    expiresAt: instrument.expires_at,
    widenedAt: until === null ? null : new Date(until.getTime() - flagHours * 3_600_000),
    widenedUntil: until,
  };
  const params = { flagHours };
  let next = transition(snapshot, { type: "resolve", at: now, resolution }, params);
  if (next.instrument.state !== "resolved" && next.instrument.state !== "expired") {
    next = transition(next.instrument, { type: "tick", now }, params);
  }
  const state = next.instrument.state;
  return state === "resolved" || state === "expired" ? { state, effects: next.effects } : null;
}

interface SettleContext {
  readonly db: Transaction<Database>;
  readonly instrument: InstrumentRow;
  readonly listing: ListingWithCompany;
  readonly market: MarketRow;
  readonly flagsById: ReadonlyMap<string, ResolvingFlag>;
  readonly now: Date;
}

/** (c) A binary pays $1 a winning share through the LMSR book's settlement. */
async function settleBinary(context: SettleContext, effect: LifecycleEffect): Promise<JsonObject> {
  const yes = effect.type === "settle";
  const flag = yes ? context.flagsById.get(effect.eventId) : undefined;
  await settleLmsrBook(context.db, {
    market: { ...context.market, market_id: context.market.id },
    winningBucket: yes ? 1 : 0,
    settledValue: yes ? "1.00" : "0.00",
    sourceUrl: flag?.source_url ?? RULEBOOK_SOURCE_URL,
    sourceDescription: yes
      ? `YES: ${flag?.kind ?? "flag"} ${effect.eventId}, rank ${flag?.source_rank ?? "?"}, rulebook ${RULEBOOK_VERSION}.`
      : `NO: no qualifying announcement by expiry, rulebook ${RULEBOOK_VERSION}.`,
    ts: context.now,
  });
  return yes
    ? {
        outcome: "yes",
        event_id: effect.eventId,
        flag_kind: flag?.kind ?? null,
        announced_at: effect.at.toISOString(),
        source_rank: flag?.source_rank ?? null,
        source_url: flag?.source_url ?? null,
      }
    : { outcome: "no" };
}

/** (c) A forward's open positions settle at forward.ts's credit, or void at their collateral. */
async function settleForward(context: SettleContext, effect: LifecycleEffect): Promise<JsonObject> {
  const { db, market, now } = context;
  const settled = effect.type === "settle" && effect.instrument === "forward" ? effect : null;
  const positions = await db
    .selectFrom("forward_positions")
    .selectAll()
    .where("instrument_id", "=", context.instrument.id)
    .where("settled_at", "is", null)
    .where("voided_at", "is", null)
    .orderBy("user_id")
    .orderBy("id")
    .forUpdate()
    .execute();
  const creditByUser = new Map<string, bigint>();
  let total = 0n;
  for (const position of positions) {
    const terms = {
      side: position.side,
      notionalCents: Number(position.notional_cents),
      entryLn: position.entry_ln,
      kappa: market.b,
    };
    const credit = BigInt(
      settled === null ? voidCreditCents(terms) : settlementCreditCents(terms, settled.settleLn),
    );
    total += credit;
    creditByUser.set(position.user_id, (creditByUser.get(position.user_id) ?? 0n) + credit);
    await db
      .updateTable("forward_positions")
      .set(
        settled === null
          ? { voided_at: now }
          : {
              settled_at: now,
              settle_ln: settled.settleLn,
              payout_cents: (credit - BigInt(position.collateral_cents)).toString(),
            },
      )
      .where("id", "=", position.id)
      .execute();
  }
  for (const [userId, credit] of [...creditByUser].sort(([a], [b]) => a.localeCompare(b))) {
    await db
      .updateTable("users")
      .set({ cash_balance_cents: sql<string>`cash_balance_cents + ${credit.toString()}::bigint` })
      .where("id", "=", userId)
      .execute();
  }

  const flag = settled === null ? undefined : context.flagsById.get(settled.eventId);
  const postMoney = flag === undefined ? null : postMoneyOf(flag.terms_json);
  await db
    .insertInto("settlements")
    .values({
      market_id: market.id,
      settled_value: postMoney === null ? "0.00" : postMoney.toFixed(2),
      winning_bucket: -1,
      source_url: flag?.source_url ?? RULEBOOK_SOURCE_URL,
      source_description:
        settled === null
          ? `Void: collateral refunded, rulebook ${RULEBOOK_VERSION}.`
          : `Settled at the rank ${settled.rank} print ${settled.eventId}${settled.final ? "" : " (provisional: a higher-ranked source may supersede it within the revision window)"}, rulebook ${RULEBOOK_VERSION}.`,
      ts: now,
    })
    .execute();
  await db
    .updateTable("markets")
    .set({
      status: "settled",
      settled_at: now,
      mm_cash_flow_cents: (BigInt(market.mm_cash_flow_cents) - total).toString(),
    })
    .where("id", "=", market.id)
    .where("status", "=", "open")
    .executeTakeFirstOrThrow();

  const counts = { positions: positions.length, credited_cents: total.toString() };
  if (settled === null) return { outcome: "void", ...counts };
  return {
    outcome: "settled",
    event_id: settled.eventId,
    announced_at: settled.at.toISOString(),
    source_rank: settled.rank,
    source_url: flag?.source_url ?? null,
    settle_ln: settled.settleLn,
    post_money_usd: postMoney,
    final: settled.final,
    ...counts,
  };
}

/** (d) The successor's listing time and, for a forward, its entry reference. */
async function successorTerms(
  context: SettleContext,
  effect: LifecycleEffect,
): Promise<{ opensAt: Date; entryRefLn: number | null }> {
  const { instrument, now } = context;
  if (instrument.kind === "binary") {
    // Listed at the announcement that resolved it, so any later one counts (decision 0002).
    return { opensAt: effect.type === "settle" ? effect.at : now, entryRefLn: null };
  }
  if (effect.type === "settle" && effect.instrument === "forward") {
    return { opensAt: now, entryRefLn: effect.settleLn };
  }
  const mid = await latestMid(context.db, instrument.id, now);
  return { opensAt: now, entryRefLn: mid?.mid_ln ?? null };
}

async function loadListing(
  db: Transaction<Database>,
  listingId: string,
): Promise<ListingWithCompany> {
  const row = await db
    .selectFrom("listings")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .selectAll("listings")
    .select(["companies.name as company_name", "companies.slug as company_slug"])
    .where("listings.id", "=", listingId)
    .executeTakeFirstOrThrow();
  const { company_name, company_slug, ...listing } = row;
  return {
    ...listing,
    company: { id: listing.company_id, name: company_name, slug: company_slug },
  };
}

/** One instrument, in the caller's transaction: promote, resolve, settle, roll. */
export async function settleInstrument(
  db: Transaction<Database>,
  instrumentId: string,
  runId: string,
  now: Date,
  flagHours: number,
): Promise<{
  outcome: InstrumentOutcome;
  promoted: string[];
  pending: PendingPromotion[];
}> {
  await sql`select pg_advisory_xact_lock(hashtext('openmarket_cron'), hashtext('settle'))`.execute(
    db,
  );
  const instrument = await db
    .selectFrom("instruments")
    .selectAll()
    .where("id", "=", instrumentId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const listing = await loadListing(db, instrument.listing_id);
  const base = {
    instrument_id: instrument.id,
    company: listing.company.name,
    kind: instrument.kind,
  };
  if (!LIVE_STATES.includes(instrument.state)) {
    return { outcome: { ...base, outcome: "skipped" }, promoted: [], pending: [] };
  }
  const market = await db
    .selectFrom("markets")
    .selectAll()
    .where("instrument_id", "=", instrument.id)
    .forUpdate()
    .executeTakeFirstOrThrow();

  const promotion = await promoteFlags(db, listing, runId, now);
  const flags = await resolvingFlags(db, listing.company_id, now);
  const resolution = resolve(instrument, listing.binary_event, flags, now);
  const terminal = terminalEffects(instrument, resolution, now, flagHours);
  if (terminal === null) return { outcome: { ...base, outcome: "open" }, ...promotion };

  const [effect, roll] = terminal.effects;
  const context: SettleContext = {
    db,
    instrument,
    listing,
    market,
    flagsById: new Map(flags.map((flag) => [flag.id, flag])),
    now,
  };
  const result =
    instrument.kind === "binary"
      ? await settleBinary(context, effect!)
      : await settleForward(context, effect!);
  // Closed first, so the successor can take the one live slot for this listing and kind.
  await db
    .updateTable("instruments")
    .set({ state: terminal.state, closed_at: now, widened_until: null })
    .where("id", "=", instrument.id)
    .execute();

  let successorId: string | null = null;
  if (roll?.type === "list_successor" && listing.delisted_at === null) {
    await sql`select pg_advisory_xact_lock(hashtext('openmarket_listing'), hashtext(${listing.id}))`.execute(
      db,
    );
    const terms = await successorTerms(context, effect!);
    const listed = await listInstrument(db, {
      listing,
      kind: instrument.kind,
      opensAt: terms.opensAt,
      entryRefLn: terms.entryRefLn,
      now,
      runId,
    });
    successorId = listed.instrument_id;
  }
  await db
    .updateTable("instruments")
    .set({
      resolution_json: JSON.stringify({
        ...result,
        resolved_at: now.toISOString(),
        rulebook_version: RULEBOOK_VERSION,
        model_version: MODEL_VERSION,
        successor_instrument_id: successorId,
      }),
    })
    .where("id", "=", instrument.id)
    .execute();
  const outcome = result.outcome as InstrumentOutcome["outcome"];
  return {
    outcome: {
      ...base,
      outcome,
      ...(typeof result.final === "boolean" ? { final: result.final } : {}),
      successor_instrument_id: successorId,
    },
    ...promotion,
  };
}

/**
 * One firing of /api/cron/settle: claims the run id, then settles every live
 * instrument in its own transaction, and records the run's summary. A failed
 * instrument fails the run; the ones before it stay settled.
 */
export async function runSettleJob(
  db: Kysely<Database>,
  runId: string,
  now: Date = new Date(),
  flagHours: number = DEALER_PARAMS.dealer.flag_hours,
): Promise<SettleJobOutcome> {
  const begun = await beginCronRun(db, "settle", runId);
  if (begun.status === "already_ran") return begun;
  try {
    const live = await db
      .selectFrom("instruments")
      .select("id")
      .where("state", "in", LIVE_STATES)
      .where("opens_at", "<=", now)
      .orderBy("listing_id")
      .orderBy("kind")
      .execute();
    const outcomes: InstrumentOutcome[] = [];
    const promoted = new Set<string>();
    const pending = new Map<string, PendingPromotion>();
    for (const { id } of live) {
      const settled = await db
        .transaction()
        .execute((transaction) => settleInstrument(transaction, id, runId, now, flagHours));
      outcomes.push(settled.outcome);
      for (const flagId of settled.promoted) promoted.add(flagId);
      for (const flag of settled.pending) pending.set(flag.flag_id, flag);
    }
    const summary: SettleRunSummary = {
      run_id: runId,
      instruments: live.length,
      resolved: outcomes.filter((row) => row.outcome !== "open" && row.outcome !== "skipped")
        .length,
      outcomes,
      promoted: [...promoted],
      pending: [...pending.values()],
    };
    await finishCronRun(db, runId, "succeeded", summary);
    return { status: "succeeded", runId, result: summary };
  } catch (error) {
    await finishCronRun(db, runId, "failed", {
      error: error instanceof Error ? error.message : "the job failed",
    });
    throw error;
  }
}
