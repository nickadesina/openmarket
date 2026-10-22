import { sql, type Transaction } from "kysely";

import { MODEL_VERSION } from "../../config/dealer.js";
import { linkedQuestionsEnabled } from "../../config/tournament.js";
import type {
  CompanyRow,
  Database,
  InstrumentKind,
  InstrumentRow,
  JsonValue,
  ListingRow,
} from "../../db/schema.js";
import { seedBinary } from "../../engine/dealer/binary.js";
import { binaryExpiry, RULEBOOK_VERSION } from "../../engine/dealer/rulebook.js";
import {
  computeMid,
  flagsByCompany,
  type LiveInstrument,
  loadAnchorPrints,
  withPrintAnchor,
} from "./compute-mids.js";
import {
  BINARY_BOOK_GRID_VERSION,
  binaryQuoteRow,
  FORWARD_BOOK_GRID_VERSION,
  forwardQuoteFor,
  forwardQuoteRow,
  LIVE_STATES,
  latestMid,
} from "./dealer-books.js";
import { linkInstrumentQuestion } from "./tournament-bridge.js";

/**
 * The list step of /api/cron/dealer, and the roll the settle job does in its
 * own transaction (CONTRACTS.md → Lifecycle): a listed name lacking a live
 * binary or forward gets the next epoch's instrument with its `markets` book,
 * its first model mid and its first quote, all in the caller's transaction.
 *
 * The binary is seeded once at the model p with the listing's fixed b and is
 * never re-centred. The forward's book opens flat (q = [0, 0]) at the mid;
 * its entry reference is the anchor's post-money for epoch 1, the settling
 * print after a settlement, and the predecessor's last mid after a void.
 */

const DAY_MS = 86_400_000;

export type ListingWithCompany = ListingRow & {
  readonly company: Pick<CompanyRow, "id" | "name" | "slug">;
};

export interface ListInstrumentInput {
  readonly listing: ListingWithCompany;
  readonly kind: InstrumentKind;
  /** Listing time: now, or for a rolled binary the announcement that resolved its predecessor. */
  readonly opensAt: Date;
  /** Forward only. Derived from the predecessor, else the anchor, when omitted. */
  readonly entryRefLn?: number | null;
  readonly now: Date;
  readonly runId: string | null;
}

export interface ListedInstrument {
  readonly instrument_id: string;
  readonly market_id: string;
  readonly company: string;
  readonly kind: InstrumentKind;
  readonly epoch: number;
  readonly opens_at: Date;
  readonly expires_at: Date;
  readonly entry_ref_ln: number | null;
  /** The model's p for a binary, mid in ln USD for a forward. */
  readonly value: number;
  /** The linked tournament question (milestone 7); null when linking is off or listed past its own expiry. */
  readonly question_slug: string | null;
}

function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The question each instrument asks (CONTRACTS.md → Tournament mapping). */
export function instrumentQuestion(
  listing: Pick<ListingRow, "binary_event">,
  companyName: string,
  kind: InstrumentKind,
  expiresAt: Date,
): string {
  if (kind === "forward") return `What will ${companyName}'s next post-money valuation be?`;
  return listing.binary_event === "public_s1"
    ? `Will ${companyName} publicly file an S-1 by ${isoDay(expiresAt)}?`
    : `Will ${companyName} announce a priced round by ${isoDay(expiresAt)}?`;
}

export function instrumentExpiry(
  listing: Pick<ListingRow, "forward_t_days">,
  kind: InstrumentKind,
  opensAt: Date,
): Date {
  return kind === "binary"
    ? binaryExpiry(opensAt)
    : new Date(opensAt.getTime() + listing.forward_t_days * DAY_MS);
}

function toLiveInstrument(
  listing: ListingWithCompany,
  instrument: Pick<InstrumentRow, "id" | "kind" | "opens_at" | "expires_at">,
): LiveInstrument {
  return {
    id: instrument.id,
    kind: instrument.kind,
    opens_at: instrument.opens_at,
    expires_at: instrument.expires_at,
    company_id: listing.company_id,
    company: listing.company.name,
    tier: listing.tier,
    binary_event: listing.binary_event,
    p_floor: listing.p_floor,
    anchor_round: listing.anchor_round,
    anchor_date: listing.anchor_date,
    anchor_post_money_usd: listing.anchor_post_money_usd,
    anchor_source_url: listing.anchor_source_url,
  };
}

function settleLnOf(resolution: JsonValue | null): number | null {
  if (resolution === null || typeof resolution !== "object" || Array.isArray(resolution)) {
    return null;
  }
  return resolution.outcome === "settled" && typeof resolution.settle_ln === "number"
    ? resolution.settle_ln
    : null;
}

/**
 * The forward's entry reference: the print that settled the predecessor, the
 * predecessor's last mid when it voided, else the (print-moved) anchor.
 */
async function forwardEntryRef(
  db: Transaction<Database>,
  predecessor: InstrumentRow | undefined,
  anchored: LiveInstrument,
  now: Date,
): Promise<number> {
  if (predecessor !== undefined) {
    const settled = settleLnOf(predecessor.resolution_json);
    if (settled !== null) return settled;
    const mid = await latestMid(db, predecessor.id, now);
    if (mid?.mid_ln != null) return mid.mid_ln;
  }
  return Math.log(Number(anchored.anchor_post_money_usd));
}

/** Lists one instrument with its book, first mid and first quote. */
export async function listInstrument(
  db: Transaction<Database>,
  input: ListInstrumentInput,
): Promise<ListedInstrument> {
  const { listing, kind, opensAt, now } = input;
  const predecessor = await db
    .selectFrom("instruments")
    .selectAll()
    .where("listing_id", "=", listing.id)
    .where("kind", "=", kind)
    .orderBy("epoch", "desc")
    .executeTakeFirst();
  const epoch = (predecessor?.epoch ?? 0) + 1;
  const expiresAt = instrumentExpiry(listing, kind, opensAt);

  const prints = await loadAnchorPrints(db, [listing.company_id], now);
  const draft = withPrintAnchor(
    toLiveInstrument(listing, { id: "", kind, opens_at: opensAt, expires_at: expiresAt }),
    prints,
  );
  const entryRefLn =
    kind === "binary"
      ? null
      : (input.entryRefLn ?? (await forwardEntryRef(db, predecessor, draft, now)));

  const instrument = await db
    .insertInto("instruments")
    .values({
      listing_id: listing.id,
      kind,
      epoch,
      question: instrumentQuestion(listing, listing.company.name, kind, expiresAt),
      opens_at: opensAt,
      expires_at: expiresAt,
      entry_ref_ln: entryRefLn,
      state: "quoting",
      widened_until: null,
      closed_at: null,
      resolution_json: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const flags = (await flagsByCompany(db, [listing.company_id], now)).get(listing.company_id);
  const mid = computeMid({ ...draft, id: instrument.id }, flags ?? [], now);
  const midRow = await db
    .insertInto("model_mids")
    .values({
      instrument_id: instrument.id,
      model_version: MODEL_VERSION,
      rulebook_version: RULEBOOK_VERSION,
      computed_at: now,
      mid_ln: kind === "forward" ? mid.value : null,
      p: kind === "binary" ? mid.value : null,
      inputs_json: JSON.stringify(mid.inputs),
      run_id: input.runId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const marketId = await insertBook(db, listing, instrument, mid.value, now);
  const question = linkedQuestionsEnabled()
    ? await linkInstrumentQuestion(db, { listing, instrument, now })
    : null;
  const quoteBase = {
    instrumentId: instrument.id,
    postedAt: now,
    reason: "list" as const,
    modelMidId: midRow.id,
  };
  const quote =
    kind === "binary"
      ? binaryQuoteRow(quoteBase, mid.value)
      : forwardQuoteRow(quoteBase, forwardQuoteFor(listing, mid.value, 0, "normal"), "normal");
  await db.insertInto("quotes").values(quote).execute();

  return {
    instrument_id: instrument.id,
    market_id: marketId,
    company: listing.company.name,
    kind,
    epoch,
    opens_at: opensAt,
    expires_at: expiresAt,
    entry_ref_ln: entryRefLn,
    value: mid.value,
    question_slug: question?.slug ?? null,
  };
}

function binaryBook(listing: ListingWithCompany, p: number) {
  const b = Number(listing.b_cents) / 100;
  const seeded = seedBinary(p, b);
  return {
    bucket_grid_version: BINARY_BOOK_GRID_VERSION,
    metric_kind: "yes_probability" as const,
    b,
    initial_q: [...seeded.q],
    q: [...seeded.q],
    current_metric: seeded.yesProbability,
  };
}

function forwardBook(listing: ListingWithCompany, midLn: number) {
  return {
    bucket_grid_version: FORWARD_BOOK_GRID_VERSION,
    metric_kind: "forward_ln" as const,
    b: listing.kappa,
    initial_q: [0, 0],
    q: [0, 0],
    current_metric: Math.exp(midLn),
  };
}

/** The instrument's `markets` row and its sequence-0 mark; returns the market id. */
async function insertBook(
  db: Transaction<Database>,
  listing: ListingWithCompany,
  instrument: InstrumentRow,
  value: number,
  now: Date,
): Promise<string> {
  const book =
    instrument.kind === "binary" ? binaryBook(listing, value) : forwardBook(listing, value);
  const market = await db
    .insertInto("markets")
    .values({
      company_id: listing.company_id,
      status: "open",
      n_buckets: 2,
      anchor_valuation: null,
      anchor_date: null,
      anchor_description: null,
      sigma: null,
      instrument_id: instrument.id,
      ...book,
    })
    .returning(["id", "current_metric"])
    .executeTakeFirstOrThrow();
  await db
    .insertInto("marks")
    .values({
      market_id: market.id,
      market_sequence: "0",
      trade_id: null,
      ts: now,
      value: market.current_metric,
    })
    .execute();
  return market.id;
}

/** Active listings (listed by `now`, not delisted) with their companies. */
export async function activeListings(
  db: Transaction<Database>,
  now: Date,
): Promise<ListingWithCompany[]> {
  const rows = await db
    .selectFrom("listings")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .selectAll("listings")
    .select(["companies.name as company_name", "companies.slug as company_slug"])
    .where("listings.delisted_at", "is", null)
    .where("listings.listed_at", "<=", now)
    .orderBy("companies.name")
    .execute();
  return rows.map(({ company_name, company_slug, ...listing }) => ({
    ...listing,
    company: { id: listing.company_id, name: company_name, slug: company_slug },
  }));
}

export interface ListInstrumentsSummary {
  readonly listings: number;
  readonly listed: readonly ListedInstrument[];
  /** Questions linked to live instruments listed before the bridge (milestone 7). */
  readonly linked: readonly string[];
}

const KINDS: readonly InstrumentKind[] = ["binary", "forward"];

/**
 * The dealer job's list step: every active listing ends it with a live
 * binary and a live forward, listed now. The settle job rolls a successor
 * in the predecessor's own transaction, so this lists epoch 1, or fills a gap
 * an operator left. A live instrument listed before the tournament bridge
 * gets its linked question here, once, while linked questions are on.
 */
export async function listInstruments(
  db: Transaction<Database>,
  runId: string | null,
  now: Date,
): Promise<ListInstrumentsSummary> {
  const listings = await activeListings(db, now);
  const listed: ListedInstrument[] = [];
  const linked: string[] = [];
  for (const listing of listings) {
    // One listing at a time, so a concurrent roll of the same name waits.
    await sql`select pg_advisory_xact_lock(hashtext('openmarket_listing'), hashtext(${listing.id}))`.execute(
      db,
    );
    const live = await db
      .selectFrom("instruments")
      .leftJoin(
        "tournament_instrument_links",
        "tournament_instrument_links.instrument_id",
        "instruments.id",
      )
      .selectAll("instruments")
      .select("tournament_instrument_links.question_id")
      .where("instruments.listing_id", "=", listing.id)
      .where("instruments.state", "in", LIVE_STATES)
      .execute();
    for (const instrument of live) {
      if (instrument.question_id !== null || !linkedQuestionsEnabled()) continue;
      const question = await linkInstrumentQuestion(db, { listing, instrument, now });
      if (question !== null) linked.push(question.slug);
    }
    for (const kind of KINDS) {
      if (live.some((row) => row.kind === kind)) continue;
      listed.push(await listInstrument(db, { listing, kind, opensAt: now, now, runId }));
    }
  }
  return { listings: listings.length, listed, linked };
}
