import type { Kysely } from "kysely";
import { MODEL_VERSION } from "../../config/dealer.js";
import type {
  Database,
  InstrumentKind,
  JsonValue,
  ReferencePriceInsert,
  ReferencePriceRow,
  TournamentQuestionKind,
  TournamentUnit,
} from "../../db/schema.js";
import {
  BLEND_SCHEDULE,
  BLEND_SCHEDULES_BY_VERSION,
  BLEND_VERSION,
  type BlendResult,
  type BlendSchedule,
  blend,
  crowdForwardLn,
} from "../../engine/dealer/blend.js";
import { RULEBOOK_VERSION } from "../../engine/dealer/rulebook.js";
import { canonicalJson } from "./compute-mids.js";
import { LIVE_STATES } from "./dealer-books.js";
import { groupBy } from "./service-helpers.js";
import { type LinkedQuestionShape, UNIT_USD } from "./tournament-bridge.js";

/**
 * The reference step of /api/cron/dealer, after `requote` (README D14,
 * TECHNICAL_DESIGN.md §8): for every live instrument, the blend of its
 * latest model mid, the traded price on its own book over the trailing
 * window, and the linked tournament question's crowd, through blend.ts.
 * A `reference_prices` row is appended per listing and kind only when the
 * value, the weights, the versions or the instrument behind them change.
 *
 * Everything the value came from is in components_json, so verify:replay
 * recomputes each row: the model mid by id, the traded average from the
 * book's trades through the sequence the step read, and the crowd from the
 * aggregate row by id.
 *
 * Traded price: a forward's is the notional-weighted entry F₀ (ln USD) of
 * the positions opened in the window; a binary's the cash-weighted average
 * fill as a YES price (a NO fill at c a share is a YES price of 1 − c),
 * clamped to [0, 1] against sub-cent rounding on tiny fills.
 *
 * Crowd: the latest aggregate of the question linked to the instrument
 * (tournament_instrument_links, milestone 7). Since blend 1.1.0 (decision
 * 0004) a binary question's aggregate is one P(YES) and a forward's the
 * median of the forecasters' levels in its unit, entering as ln USD; under
 * 1.0.0 the forward's was a median read off the bucket vector. Below N_min
 * forecasters blend.ts gives it no weight; with no link there is no crowd.
 * Stored rows are append-only and keep the components JSON they were
 * written with.
 */

const DAY_MS = 86_400_000;

export interface ModelComponent {
  readonly model_mid_id: string;
  readonly computed_at: string;
  /** ln USD for a forward, probability for a binary. */
  readonly value: number;
}

export interface TradedComponent {
  readonly weighting: "notional_entry_ln" | "cash_yes_price";
  readonly window_days: number;
  /** Exclusive start of the window. */
  readonly from: string;
  /** Inclusive end of the window: the row's as_of. */
  readonly to: string;
  /** The book's last market sequence when the step read it; later trades are not in this row. */
  readonly through_sequence: string;
  readonly trades: number;
  readonly volume_usd: number;
  /** p̄_traded, or null with no volume. */
  readonly value: number | null;
}

export interface CrowdComponent {
  readonly question_id: string;
  readonly aggregate_id: string;
  readonly computed_at: string;
  readonly n_forecasters: number;
  /** The linked question's kind. Rows written under blend 1.0.0 do not carry it. */
  readonly kind: TournamentQuestionKind;
  /** A forward question's unit; null for a binary (1.0.0 rows carry "bool"). */
  readonly unit: TournamentUnit | null;
  /** The aggregate as published: a forward's median level in its unit, or a binary's P(YES). */
  readonly reported: number | null;
  /** In the model's unit: ln USD for a forward, probability for a binary. */
  readonly value: number | null;
}

export interface ReferenceComponents {
  readonly instrument_id: string;
  readonly kind: InstrumentKind;
  readonly model: ModelComponent;
  readonly traded: TradedComponent;
  readonly crowd: CrowdComponent | null;
  readonly schedule: BlendSchedule;
}

/** One trade as the traded average weighs it. */
export interface TradedFill {
  readonly weightCents: number;
  readonly value: number;
}

/** Σ w·v / Σ w with Σ w in USD; null value when nothing weighs. */
export function tradedAverage(fills: readonly TradedFill[]): {
  readonly volumeUsd: number;
  readonly value: number | null;
} {
  let weight = 0;
  let weighted = 0;
  for (const fill of fills) {
    weight += fill.weightCents;
    weighted += fill.weightCents * fill.value;
  }
  return weight > 0
    ? { volumeUsd: weight / 100, value: weighted / weight }
    : { volumeUsd: 0, value: null };
}

/** A binary fill's YES price from its side, cash and quantity. */
export function binaryYesPrice(side: string, cashCents: number, quantity: number): number {
  const perShare = quantity > 0 ? cashCents / 100 / quantity : 0;
  const yes = side === "no" ? 1 - perShare : perShare;
  return Math.min(1, Math.max(0, yes));
}

/**
 * The crowd in the model's unit, or null when the aggregate does not report
 * one or the question is not the instrument's kind: a binary's `p`, a
 * forward's ln(value · USD per unit).
 */
export function crowdValue(
  kind: InstrumentKind,
  question: LinkedQuestionShape,
  aggregate: { readonly p: string | null; readonly value: string | null },
): { readonly reported: number | null; readonly value: number | null } {
  if (kind === "binary") {
    const p = aggregate.p === null ? null : Number(aggregate.p);
    const ok = question.kind === "binary" && p !== null && Number.isFinite(p) && p >= 0 && p <= 1;
    return { reported: p, value: ok ? p : null };
  }
  const level = aggregate.value === null ? null : Number(aggregate.value);
  if (
    question.kind !== "forward" ||
    question.unit === null ||
    level === null ||
    !Number.isFinite(level) ||
    level <= 0
  ) {
    return { reported: level, value: null };
  }
  return { reported: level, value: crowdForwardLn(level * UNIT_USD[question.unit]) };
}

/** R from the stored components, under the given schedule. */
export function blendFromComponents(
  components: ReferenceComponents,
  schedule: BlendSchedule = BLEND_SCHEDULE,
): BlendResult {
  const { traded, crowd } = components;
  return blend(
    {
      kind: components.kind,
      model: components.model.value,
      traded: traded.value === null ? null : { value: traded.value, volumeUsd: traded.volume_usd },
      crowd:
        crowd === null || crowd.value === null
          ? null
          : { value: crowd.value, forecasters: crowd.n_forecasters },
    },
    schedule,
  );
}

interface InstrumentBookRef {
  readonly instrument_id: string;
  readonly kind: InstrumentKind;
  readonly market_id: string;
}

async function referenceTrades(db: Kysely<Database>, marketIds: readonly string[], at?: Date) {
  if (marketIds.length === 0) return [];
  let query = db
    .selectFrom("trades")
    .leftJoin("forward_positions", "forward_positions.trade_id", "trades.id")
    .select([
      "trades.market_id",
      "trades.market_sequence",
      "trades.created_at",
      "trades.contract_side",
      "trades.cash_amount_cents",
      "trades.quantity",
      "forward_positions.notional_cents",
      "forward_positions.entry_ln",
    ])
    .where("trades.market_id", "in", marketIds)
    .orderBy("trades.market_sequence");
  if (at !== undefined)
    query = query
      .where(
        "trades.created_at",
        ">",
        new Date(at.getTime() - BLEND_SCHEDULE.traded.window_days * DAY_MS),
      )
      .where("trades.created_at", "<=", at);
  return query.execute();
}
type ReferenceTrade = Awaited<ReturnType<typeof referenceTrades>>[number];

/** The traded component over (to − window, to], in original market sequence order. */
function tradedComponent(
  book: InstrumentBookRef,
  to: Date,
  throughSequence: string,
  windowDays: number,
  rows: readonly ReferenceTrade[],
): TradedComponent {
  const from = new Date(to.getTime() - windowDays * DAY_MS);
  const fills = rows
    .filter(
      (row) =>
        row.created_at > from &&
        row.created_at <= to &&
        BigInt(row.market_sequence) <= BigInt(throughSequence),
    )
    .filter((row) => book.kind !== "forward" || row.entry_ln !== null)
    .map((row) =>
      book.kind === "forward"
        ? { weightCents: Number(row.notional_cents), value: row.entry_ln! }
        : {
            weightCents: Number(row.cash_amount_cents),
            value: binaryYesPrice(row.contract_side, Number(row.cash_amount_cents), row.quantity),
          },
    );
  const average = tradedAverage(fills);
  return {
    weighting: book.kind === "forward" ? "notional_entry_ln" : "cash_yes_price",
    window_days: windowDays,
    from: from.toISOString(),
    to: to.toISOString(),
    through_sequence: throughSequence,
    trades: fills.length,
    volume_usd: average.volumeUsd,
    value: average.value,
  };
}

/** Latest linked crowds for every live instrument, fetched as one query. */
async function crowdComponents(
  db: Kysely<Database>,
  ids: readonly string[],
  at: Date,
): Promise<Map<string, CrowdComponent>> {
  const rows = await db
    .selectFrom("tournament_instrument_links")
    .innerJoin(
      "tournament_questions",
      "tournament_questions.id",
      "tournament_instrument_links.question_id",
    )
    .innerJoin(
      "tournament_aggregates",
      "tournament_aggregates.question_id",
      "tournament_questions.id",
    )
    .innerJoin("instruments", "instruments.id", "tournament_instrument_links.instrument_id")
    .select([
      "tournament_instrument_links.instrument_id",
      "tournament_questions.id as question_id",
      "tournament_questions.kind",
      "tournament_questions.unit",
      "instruments.kind as instrument_kind",
      "tournament_aggregates.id",
      "tournament_aggregates.computed_at",
      "tournament_aggregates.n_forecasters",
      "tournament_aggregates.p",
      "tournament_aggregates.value",
    ])
    .where("tournament_instrument_links.instrument_id", "in", ids)
    .where("tournament_aggregates.computed_at", "<=", at)
    .distinctOn("tournament_instrument_links.instrument_id")
    .orderBy("tournament_instrument_links.instrument_id")
    .orderBy("tournament_aggregates.computed_at", "desc")
    .orderBy("tournament_aggregates.id", "desc")
    .execute();
  return new Map(
    rows.map((row) => [
      row.instrument_id,
      {
        question_id: row.question_id,
        aggregate_id: row.id,
        computed_at: row.computed_at.toISOString(),
        n_forecasters: row.n_forecasters,
        kind: row.kind,
        unit: row.unit,
        ...crowdValue(row.instrument_kind, row, row),
      },
    ]),
  );
}

interface LiveBook extends InstrumentBookRef {
  readonly listing_id: string;
  readonly company: string;
  readonly last_market_sequence: string;
}

async function liveBooks(db: Kysely<Database>): Promise<LiveBook[]> {
  return db
    .selectFrom("instruments")
    .innerJoin("listings", "listings.id", "instruments.listing_id")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .innerJoin("markets", "markets.instrument_id", "instruments.id")
    .select([
      "instruments.id as instrument_id",
      "instruments.kind",
      "instruments.listing_id",
      "companies.name as company",
      "markets.id as market_id",
      "markets.last_market_sequence",
    ])
    .where("instruments.state", "in", LIVE_STATES)
    .orderBy("companies.name")
    .orderBy("instruments.kind")
    .execute();
}

/** The latest published reference of a listing and kind. */
export async function latestReference(
  db: Kysely<Database>,
  listingId: string,
  kind: InstrumentKind,
): Promise<ReferencePriceRow | undefined> {
  return db
    .selectFrom("reference_prices")
    .selectAll()
    .where("listing_id", "=", listingId)
    .where("kind", "=", kind)
    .orderBy("as_of", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
}

function instrumentOf(components: JsonValue): string | null {
  if (components === null || typeof components !== "object" || Array.isArray(components)) {
    return null;
  }
  const id = components.instrument_id;
  return typeof id === "string" ? id : null;
}

/** Whether a fresh row would repeat the latest: same instrument, versions, value and weights. */
function sameReference(
  previous: ReferencePriceRow | undefined,
  next: ReferencePriceInsert,
  instrumentId: string,
): boolean {
  return (
    previous !== undefined &&
    instrumentOf(previous.components_json) === instrumentId &&
    previous.blend_version === next.blend_version &&
    previous.model_version === next.model_version &&
    previous.rulebook_version === next.rulebook_version &&
    previous.value === next.value &&
    previous.w_model === next.w_model &&
    previous.w_traded === next.w_traded &&
    previous.w_crowd === next.w_crowd
  );
}

export interface ReferenceStepSummary {
  readonly instruments: number;
  readonly written: readonly {
    readonly listing_id: string;
    readonly company: string;
    readonly kind: InstrumentKind;
    readonly value: number;
    readonly model_only: boolean;
  }[];
  readonly unchanged: number;
}

/** Appends a reference row for every live instrument whose blend moved. */
export async function writeReferencePrices(
  db: Kysely<Database>,
  now: Date,
): Promise<ReferenceStepSummary> {
  const books = await liveBooks(db);
  if (books.length === 0) return { instruments: 0, written: [], unchanged: 0 };
  const ids = books.map((book) => book.instrument_id);
  const [trades, mids, crowds, references] = await Promise.all([
    referenceTrades(
      db,
      books.map((book) => book.market_id),
      now,
    ),
    db
      .selectFrom("model_mids")
      .selectAll()
      .where("instrument_id", "in", ids)
      .where("computed_at", "<=", now)
      .distinctOn("instrument_id")
      .orderBy("instrument_id")
      .orderBy("computed_at", "desc")
      .orderBy("id", "desc")
      .execute(),
    crowdComponents(db, ids, now),
    db
      .selectFrom("reference_prices")
      .selectAll()
      .where(
        "listing_id",
        "in",
        books.map((book) => book.listing_id),
      )
      .distinctOn(["listing_id", "kind"])
      .orderBy("listing_id")
      .orderBy("kind")
      .orderBy("as_of", "desc")
      .orderBy("id", "desc")
      .execute(),
  ]);
  const tradesByMarket = groupBy(trades, (row) => row.market_id);
  const midsByInstrument = new Map(mids.map((row) => [row.instrument_id, row]));
  const previous = new Map(references.map((row) => [`${row.listing_id}:${row.kind}`, row]));
  const written: ReferenceStepSummary["written"][number][] = [];
  let unchanged = 0;
  for (const book of books) {
    const mid = midsByInstrument.get(book.instrument_id);
    const model = book.kind === "forward" ? mid?.mid_ln : mid?.p;
    if (mid === undefined || model === null || model === undefined) continue;
    const components: ReferenceComponents = {
      instrument_id: book.instrument_id,
      kind: book.kind,
      model: { model_mid_id: mid.id, computed_at: mid.computed_at.toISOString(), value: model },
      traded: tradedComponent(
        book,
        now,
        book.last_market_sequence,
        BLEND_SCHEDULE.traded.window_days,
        tradesByMarket.get(book.market_id) ?? [],
      ),
      crowd: crowds.get(book.instrument_id) ?? null,
      schedule: BLEND_SCHEDULE,
    };
    const result = blendFromComponents(components);
    const row: ReferencePriceInsert = {
      listing_id: book.listing_id,
      kind: book.kind,
      as_of: now,
      value: result.value,
      blend_version: BLEND_VERSION,
      model_version: MODEL_VERSION,
      rulebook_version: RULEBOOK_VERSION,
      w_model: result.weights.model,
      w_traded: result.weights.traded,
      w_crowd: result.weights.crowd,
      components_json: JSON.stringify(components),
    };
    if (sameReference(previous.get(`${book.listing_id}:${book.kind}`), row, book.instrument_id)) {
      unchanged += 1;
      continue;
    }
    await db.insertInto("reference_prices").values(row).execute();
    written.push({
      listing_id: book.listing_id,
      company: book.company,
      kind: book.kind,
      value: result.value,
      model_only: result.modelOnly,
    });
  }
  return { instruments: books.length, written, unchanged };
}

/** A stored reference must recompute from its components this closely. */
const REFERENCE_TOLERANCE = 1e-12;

export interface ReferenceFinding {
  readonly id: string;
  readonly detail: string;
}

function isComponents(value: unknown): value is ReferenceComponents {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.instrument_id === "string" &&
    (record.kind === "forward" || record.kind === "binary") &&
    typeof record.model === "object" &&
    record.model !== null &&
    typeof record.traded === "object" &&
    record.traded !== null &&
    typeof record.schedule === "object" &&
    record.schedule !== null
  );
}

function near(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= REFERENCE_TOLERANCE;
}

async function referenceSnapshot(db: Kysely<Database>, rows: readonly ReferencePriceRow[]) {
  const components: ReferenceComponents[] = [];
  for (const row of rows)
    if (isComponents(row.components_json)) components.push(row.components_json);
  const ids = [...new Set(components.map((row) => row.instrument_id))];
  const midIds = [...new Set(components.map((row) => row.model.model_mid_id))];
  const crowdIds = components.flatMap((row) =>
    row.crowd === null ? [] : [row.crowd.aggregate_id],
  );
  const books =
    ids.length === 0
      ? []
      : await db
          .selectFrom("instruments")
          .innerJoin("markets", "markets.instrument_id", "instruments.id")
          .select([
            "instruments.id",
            "instruments.listing_id",
            "instruments.kind",
            "markets.id as market_id",
          ])
          .where("instruments.id", "in", ids)
          .execute();
  const [mids, crowds, trades] = await Promise.all([
    midIds.length === 0
      ? []
      : db.selectFrom("model_mids").selectAll().where("id", "in", midIds).execute(),
    crowdIds.length === 0
      ? []
      : db
          .selectFrom("tournament_aggregates")
          .innerJoin(
            "tournament_questions",
            "tournament_questions.id",
            "tournament_aggregates.question_id",
          )
          .selectAll("tournament_aggregates")
          .select(["tournament_questions.kind", "tournament_questions.unit"])
          .where("tournament_aggregates.id", "in", crowdIds)
          .execute(),
    referenceTrades(
      db,
      books.map((book) => book.market_id),
    ),
  ]);
  return {
    books: new Map(books.map((row) => [row.id, row])),
    mids: new Map(mids.map((row) => [row.id, row])),
    crowds: new Map(crowds.map((row) => [row.id, row])),
    trades: groupBy(trades, (row) => row.market_id),
  };
}
type ReferenceSnapshot = Awaited<ReturnType<typeof referenceSnapshot>>;

/** The checks on one row's components against the tables they cite; the first failure, or null. */
function checkComponents(
  snapshot: ReferenceSnapshot,
  row: ReferencePriceRow,
  components: ReferenceComponents,
): string | null {
  const book = snapshot.books.get(components.instrument_id);
  if (book === undefined || book.listing_id !== row.listing_id || book.kind !== row.kind) {
    return `instrument ${components.instrument_id} is not this listing's ${row.kind}`;
  }
  const mid = snapshot.mids.get(components.model.model_mid_id);
  const midValue = row.kind === "forward" ? mid?.mid_ln : mid?.p;
  if (
    mid === undefined ||
    mid.instrument_id !== components.instrument_id ||
    mid.computed_at > row.as_of ||
    midValue !== components.model.value
  ) {
    return `model mid ${components.model.model_mid_id} does not give ${components.model.value}`;
  }
  const traded = tradedComponent(
    { instrument_id: components.instrument_id, kind: row.kind, market_id: book.market_id },
    row.as_of,
    components.traded.through_sequence,
    components.traded.window_days,
    snapshot.trades.get(book.market_id) ?? [],
  );
  if (
    traded.trades !== components.traded.trades ||
    !near(traded.volume_usd, components.traded.volume_usd) ||
    !near(traded.value, components.traded.value)
  ) {
    return `traded ${components.traded.value} over ${components.traded.trades} trades; the book gives ${traded.value} over ${traded.trades}`;
  }
  if (components.crowd !== null) {
    const cited = components.crowd;
    const crowd = crowdById(snapshot, cited, row.kind);
    if (
      crowd === null ||
      new Date(cited.computed_at) > row.as_of ||
      crowd.n_forecasters !== cited.n_forecasters ||
      !near(crowd.value, cited.value)
    ) {
      return `crowd aggregate ${cited.aggregate_id} does not give ${cited.value}`;
    }
  }
  return null;
}

/** The cited aggregate, recomputed, using the immutable question id recorded at publication. */
function crowdById(
  snapshot: ReferenceSnapshot,
  cited: CrowdComponent,
  kind: InstrumentKind,
): CrowdComponent | null {
  const aggregate = snapshot.crowds.get(cited.aggregate_id);
  if (aggregate === undefined || aggregate.question_id !== cited.question_id) return null;
  return {
    ...cited,
    n_forecasters: aggregate.n_forecasters,
    ...crowdValue(kind, aggregate, aggregate),
  };
}

/**
 * verify:replay's reference half: every `reference_prices` row recomputes
 * from its components through blend.ts under its own blend version, and
 * each component from the table it cites.
 */
export async function verifyReferencePrices(
  db: Kysely<Database>,
  publishedModelVersions: Readonly<Record<string, string>>,
): Promise<{ readonly checked: number; readonly findings: ReferenceFinding[] }> {
  const rows = await db
    .selectFrom("reference_prices")
    .selectAll()
    .orderBy("as_of")
    .orderBy("id")
    .execute();
  const snapshot = await referenceSnapshot(db, rows);
  const findings: ReferenceFinding[] = [];
  for (const row of rows) {
    const fail = (detail: string) => findings.push({ id: row.id, detail });
    const schedule = BLEND_SCHEDULES_BY_VERSION[row.blend_version];
    if (schedule === undefined) {
      fail(`blend_version ${row.blend_version} was never published`);
      continue;
    }
    if (publishedModelVersions[row.model_version] === undefined) {
      fail(`model_version ${row.model_version} was never published`);
      continue;
    }
    const components = row.components_json;
    if (!isComponents(components) || components.kind !== row.kind) {
      fail(`components_json does not describe a ${row.kind} reference`);
      continue;
    }
    if (
      canonicalJson(components.schedule as unknown as JsonValue) !==
      canonicalJson(schedule as unknown as JsonValue)
    ) {
      fail(`components carry a schedule other than blend ${row.blend_version}'s`);
      continue;
    }
    let result: BlendResult;
    try {
      result = blendFromComponents(components, schedule);
    } catch (error) {
      fail(error instanceof Error ? error.message : "components do not blend");
      continue;
    }
    if (
      !near(result.value, row.value) ||
      !near(result.weights.model, row.w_model) ||
      !near(result.weights.traded, row.w_traded) ||
      !near(result.weights.crowd, row.w_crowd)
    ) {
      fail(`stored ${row.value}, recomputed ${result.value} from its components`);
      continue;
    }
    const mismatch = checkComponents(snapshot, row, components);
    if (mismatch !== null) fail(mismatch);
  }
  return { checked: rows.length, findings };
}
