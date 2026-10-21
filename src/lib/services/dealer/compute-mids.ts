import type { Kysely } from "kysely";

import {
  DEALER_PARAMS,
  type DealerParams,
  MODEL_VERSION,
  PARAMS_SHA256_BY_MODEL_VERSION,
} from "../../config/dealer.js";
import type {
  BinaryEventKind,
  Database,
  EventFlagKind,
  InstrumentKind,
  InstrumentState,
  JsonObject,
  JsonValue,
} from "../../db/schema.js";
import {
  binaryProbability,
  daysBetween,
  forwardMid,
  type HazardParams,
  type Tier,
} from "../../engine/dealer/prior.js";
import {
  type FlagTerms,
  postMoneyUsd,
  RULEBOOK_VERSION,
} from "../../engine/dealer/rulebook.js";

/**
 * The mid step of /api/cron/dealer (TECHNICAL_DESIGN.md §5): one model mid
 * per live instrument from its listing's anchor, params.json and the event
 * flags seen since the anchor, through prior.ts.
 *
 * A row is appended only when the mid or its inputs differ from the
 * instrument's latest row (the forward's `as_of` aside), so the tape moves
 * when the model does and not every fifteen minutes; a binary's p is its
 * seed price and only a version change rewrites it.
 *
 * The anchor is the name's last print as of the instrument's listing: the
 * listing's anchor round, or a later `print` flag with a post-money, so a
 * successor rolled from a settlement prices off the print that settled its
 * predecessor (CONTRACTS.md → Contract B).
 */

const LIVE_STATES: readonly InstrumentState[] = ["quoting", "widened"];
/** Flags that can carry news of the next round: the leak sim.py reads off it. */
const LEAK_KINDS: readonly EventFlagKind[] = ["scoop", "release"];

const PUBLIC_S1_NOTE =
  "Public S-1 binary priced with the round-hazard prior as-is (README D12, decided 2026-10-21).";

export interface MidAnchor {
  readonly round: string;
  /** YYYY-MM-DD: the hazard's clock starts here and only flags after this day count. */
  readonly date: string;
  readonly post_money_usd: number;
  readonly source_url: string;
  /** The `print` flag the anchor is, when it is not the listing's anchor round. */
  readonly flag_id?: string;
}

export interface BinaryMidInputs {
  readonly kind: "binary";
  readonly company: string;
  readonly binary_event: BinaryEventKind;
  readonly tier: Tier;
  readonly anchor: MidAnchor;
  readonly listed_at: string;
  readonly expires_at: string;
  readonly k: number;
  readonly lambda_months: number;
  readonly days_per_month: number;
  readonly leak_hazard_near: number;
  readonly leak_hazard_far: number;
  readonly leak_window_days: number;
  readonly p_floor: number;
  /** The latest scoop or release after the anchor, dated on or before listing. */
  readonly leak: {
    readonly flag_id: string;
    readonly kind: EventFlagKind;
    readonly at: string;
  } | null;
  readonly params_sha256: string;
  readonly note?: string;
}

export interface ForwardMidInputs {
  readonly kind: "forward";
  readonly company: string;
  readonly tier: Tier;
  readonly anchor: MidAnchor;
  readonly mu: number;
  /** Whether μ is the name's own leave-one-out step-up or the tier fallback. */
  readonly mu_source: "company" | "fallback";
  readonly as_of: string;
  /** The latest scoop after the anchor that reported a valuation. */
  readonly leak: {
    readonly flag_id: string;
    readonly at: string;
    readonly valuation_usd: number;
  } | null;
  readonly params_sha256: string;
}

export type MidInputs = BinaryMidInputs | ForwardMidInputs;

/** A live instrument with its listing, as the step reads it. */
export interface LiveInstrument {
  readonly id: string;
  readonly kind: InstrumentKind;
  readonly opens_at: Date;
  readonly expires_at: Date;
  readonly company_id: string;
  readonly company: string;
  readonly tier: Tier;
  readonly binary_event: BinaryEventKind;
  readonly p_floor: number;
  readonly anchor_round: string;
  readonly anchor_date: string;
  readonly anchor_post_money_usd: string;
  readonly anchor_source_url: string;
  /** Set when the anchor is a later `print` flag rather than the listing's round. */
  readonly anchor_flag_id?: string | null;
}

/** A `print` flag as the anchor lookup reads it; `at` is published_at, else observed_at. */
export interface AnchorPrint {
  readonly id: string;
  readonly company_id: string;
  readonly at: Date;
  readonly observed_at: Date;
  readonly source_url: string | null;
  readonly terms_json: JsonObject;
}

/** An event flag as the step reads it; `at` is published_at, else observed_at. */
export interface MidFlag {
  readonly id: string;
  readonly kind: EventFlagKind;
  readonly at: Date;
  readonly observed_at: Date;
  readonly terms_json: JsonObject;
}

export interface ComputedMid {
  readonly instrumentId: string;
  readonly kind: InstrumentKind;
  /** ln USD for a forward, probability for a binary. */
  readonly value: number;
  readonly inputs: MidInputs;
}

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function latest<T extends { readonly at: Date }>(items: readonly T[]): T | null {
  let found: T | null = null;
  for (const item of items) if (found === null || item.at > found.at) found = item;
  return found;
}

/** A scoop's reported valuation in USD, or null when it reported none. */
export function scoopValuationUsd(terms: JsonObject): number | null {
  const value = terms.valuation_usd;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Flags seen by `now` and dated after the anchor's day: the news since the last print. */
export function flagsSinceAnchor(
  flags: readonly MidFlag[],
  anchorDate: string,
  now: Date,
): MidFlag[] {
  const anchor = day(anchorDate);
  return flags.filter(
    (flag) => flag.observed_at <= now && flag.at <= now && daysBetween(anchor, flag.at) > 0,
  );
}

function anchorOf(instrument: LiveInstrument): MidAnchor {
  return {
    round: instrument.anchor_round,
    date: instrument.anchor_date,
    post_money_usd: Number(instrument.anchor_post_money_usd),
    source_url: instrument.anchor_source_url,
    ...(instrument.anchor_flag_id ? { flag_id: instrument.anchor_flag_id } : {}),
  };
}

function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * The instrument with its anchor moved to the latest print seen and dated by
 * its listing time, on a later day than the listing's anchor round, with a
 * post-money. Without one the listing's anchor stands. Pure.
 */
export function withPrintAnchor<T extends LiveInstrument>(
  instrument: T,
  prints: readonly AnchorPrint[],
): T {
  const anchorDay = day(instrument.anchor_date);
  let found: { readonly print: AnchorPrint; readonly postMoney: number } | null = null;
  for (const print of prints) {
    if (print.company_id !== instrument.company_id) continue;
    if (print.observed_at > instrument.opens_at || print.at > instrument.opens_at) continue;
    if (daysBetween(anchorDay, print.at) <= 0) continue;
    const postMoney = postMoneyUsd(print.terms_json as unknown as FlagTerms);
    if (postMoney === null) continue;
    const later =
      found === null ||
      print.at > found.print.at ||
      (print.at.getTime() === found.print.at.getTime() && print.id > found.print.id);
    if (later) found = { print, postMoney };
  }
  if (found === null) return instrument;
  return {
    ...instrument,
    anchor_round: `print of ${isoDay(found.print.at)}`,
    anchor_date: isoDay(found.print.at),
    anchor_post_money_usd: String(found.postMoney),
    anchor_source_url: found.print.source_url ?? instrument.anchor_source_url,
    anchor_flag_id: found.print.id,
  };
}

/** Every `print` flag of these companies, for withPrintAnchor. */
export async function loadAnchorPrints(
  db: Kysely<Database>,
  companyIds: readonly string[],
): Promise<AnchorPrint[]> {
  if (companyIds.length === 0) return [];
  const rows = await db
    .selectFrom("event_flags")
    .select(["id", "company_id", "observed_at", "published_at", "source_url", "terms_json"])
    .where("company_id", "in", companyIds)
    .where("kind", "=", "print")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    company_id: row.company_id,
    at: row.published_at ?? row.observed_at,
    observed_at: row.observed_at,
    source_url: row.source_url,
    terms_json: row.terms_json,
  }));
}

/**
 * Everything a mid needs, from the instrument, its listing, params.json and
 * the company's flags. Pure: `flags` may hold any of the company's flags;
 * only those seen by `now` and dated after the anchor count.
 */
export function midInputs(
  instrument: LiveInstrument,
  flags: readonly MidFlag[],
  now: Date,
  params: DealerParams = DEALER_PARAMS,
  paramsSha256: string = PARAMS_SHA256_BY_MODEL_VERSION[MODEL_VERSION]!,
): MidInputs {
  const anchor = anchorOf(instrument);
  const news = flagsSinceAnchor(flags, instrument.anchor_date, now);
  const prior = params.prior;

  if (instrument.kind === "binary") {
    const leak = latest(
      news.filter(
        (flag) => LEAK_KINDS.includes(flag.kind) && daysBetween(flag.at, instrument.opens_at) >= 0,
      ),
    );
    return {
      kind: "binary",
      company: instrument.company,
      binary_event: instrument.binary_event,
      tier: instrument.tier,
      anchor,
      listed_at: instrument.opens_at.toISOString(),
      expires_at: instrument.expires_at.toISOString(),
      k: prior.weibull_k,
      lambda_months: prior.cadence_months[instrument.tier],
      days_per_month: prior.days_per_month,
      leak_hazard_near: prior.leak_hazard_near,
      leak_hazard_far: prior.leak_hazard_far,
      leak_window_days: prior.leak_window_days,
      p_floor: instrument.p_floor,
      leak: leak === null ? null : { flag_id: leak.id, kind: leak.kind, at: leak.at.toISOString() },
      params_sha256: paramsSha256,
      ...(instrument.binary_event === "public_s1" ? { note: PUBLIC_S1_NOTE } : {}),
    };
  }

  const own = prior.mu_stepup[instrument.company];
  const leak = latest(
    news.filter((flag) => flag.kind === "scoop" && scoopValuationUsd(flag.terms_json) !== null),
  );
  return {
    kind: "forward",
    company: instrument.company,
    tier: instrument.tier,
    anchor,
    mu: (own ?? prior.mu_stepup_fallback)[instrument.tier],
    mu_source: own === undefined ? "fallback" : "company",
    as_of: now.toISOString(),
    leak:
      leak === null
        ? null
        : {
            flag_id: leak.id,
            at: leak.at.toISOString(),
            valuation_usd: scoopValuationUsd(leak.terms_json)!,
          },
    params_sha256: paramsSha256,
  };
}

/** The mid from its stored inputs alone: what verify:replay recomputes. */
export function midFromInputs(inputs: MidInputs): number {
  const lastPrintAt = day(inputs.anchor.date);
  if (inputs.kind === "binary") {
    const hazard: HazardParams = {
      cadence_months: { mega: inputs.lambda_months, redhot: inputs.lambda_months },
      weibull_k: inputs.k,
      days_per_month: inputs.days_per_month,
      leak_hazard_near: inputs.leak_hazard_near,
      leak_hazard_far: inputs.leak_hazard_far,
      leak_window_days: inputs.leak_window_days,
    };
    return binaryProbability(
      {
        tier: inputs.tier,
        lastPrintAt,
        listedAt: new Date(inputs.listed_at),
        expiresAt: new Date(inputs.expires_at),
        leakAt: inputs.leak === null ? null : new Date(inputs.leak.at),
      },
      hazard,
      inputs.p_floor,
    );
  }
  return forwardMid({
    lastPostMoneyUsd: inputs.anchor.post_money_usd,
    mu: inputs.mu,
    asOf: new Date(inputs.as_of),
    leak:
      inputs.leak === null
        ? null
        : { at: new Date(inputs.leak.at), postMoneyUsd: inputs.leak.valuation_usd },
  });
}

export function computeMid(
  instrument: LiveInstrument,
  flags: readonly MidFlag[],
  now: Date,
): ComputedMid {
  const inputs = midInputs(instrument, flags, now);
  return {
    instrumentId: instrument.id,
    kind: instrument.kind,
    value: midFromInputs(inputs),
    inputs,
  };
}

/** The latest stored mid, as compared against a fresh one. */
export interface StoredMid {
  readonly model_version: string;
  readonly rulebook_version: string;
  readonly value: number;
  readonly inputs: JsonValue;
}

function withoutAsOf(inputs: JsonValue): JsonValue {
  if (inputs === null || typeof inputs !== "object" || Array.isArray(inputs)) return inputs;
  const { as_of: _asOf, ...rest } = inputs;
  return rest;
}

/** Stable JSON: object keys sorted, so jsonb's key order does not matter. */
function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
}

/** True when `next` would repeat `previous`: same versions, value and inputs but the as-of. */
export function sameMid(
  previous: StoredMid | undefined,
  next: ComputedMid,
  modelVersion: string = MODEL_VERSION,
  rulebookVersion: string = RULEBOOK_VERSION,
): boolean {
  return (
    previous !== undefined &&
    previous.model_version === modelVersion &&
    previous.rulebook_version === rulebookVersion &&
    previous.value === next.value &&
    canonical(withoutAsOf(previous.inputs)) ===
      canonical(withoutAsOf(next.inputs as unknown as JsonValue))
  );
}

export interface ComputeMidsSummary {
  readonly instruments: number;
  readonly mids_written: number;
  readonly unchanged: number;
  readonly mids: readonly {
    readonly instrument_id: string;
    readonly kind: InstrumentKind;
    readonly company: string;
    readonly value: number;
    readonly written: boolean;
  }[];
}

async function liveInstruments(db: Kysely<Database>): Promise<LiveInstrument[]> {
  const rows = await db
    .selectFrom("instruments")
    .innerJoin("listings", "listings.id", "instruments.listing_id")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .select([
      "instruments.id",
      "instruments.kind",
      "instruments.opens_at",
      "instruments.expires_at",
      "listings.company_id",
      "companies.name as company",
      "listings.tier",
      "listings.binary_event",
      "listings.p_floor",
      "listings.anchor_round",
      "listings.anchor_date",
      "listings.anchor_post_money_usd",
      "listings.anchor_source_url",
    ])
    .where("instruments.state", "in", LIVE_STATES)
    .orderBy("companies.name")
    .orderBy("instruments.kind")
    .execute();
  const prints = await loadAnchorPrints(db, [...new Set(rows.map((row) => row.company_id))]);
  return rows.map((row) => withPrintAnchor(row, prints));
}

export async function flagsByCompany(
  db: Kysely<Database>,
  companyIds: readonly string[],
  now: Date,
): Promise<Map<string, MidFlag[]>> {
  const byCompany = new Map<string, MidFlag[]>();
  if (companyIds.length === 0) return byCompany;
  const rows = await db
    .selectFrom("event_flags")
    .select(["id", "company_id", "kind", "observed_at", "published_at", "terms_json"])
    .where("company_id", "in", companyIds)
    .where("kind", "in", LEAK_KINDS)
    .where("observed_at", "<=", now)
    .execute();
  for (const row of rows) {
    const flags = byCompany.get(row.company_id) ?? [];
    flags.push({
      id: row.id,
      kind: row.kind,
      at: row.published_at ?? row.observed_at,
      observed_at: row.observed_at,
      terms_json: row.terms_json,
    });
    byCompany.set(row.company_id, flags);
  }
  return byCompany;
}

async function latestStoredMids(
  db: Kysely<Database>,
  instrumentIds: readonly string[],
): Promise<Map<string, StoredMid>> {
  if (instrumentIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("model_mids")
    .select(["instrument_id", "model_version", "rulebook_version", "mid_ln", "p", "inputs_json"])
    .distinctOn("instrument_id")
    .where("instrument_id", "in", instrumentIds)
    .orderBy("instrument_id")
    .orderBy("computed_at", "desc")
    .orderBy("id", "desc")
    .execute();
  return new Map(
    rows.map((row) => [
      row.instrument_id,
      {
        model_version: row.model_version,
        rulebook_version: row.rulebook_version,
        value: (row.mid_ln ?? row.p)!,
        inputs: row.inputs_json,
      },
    ]),
  );
}

/**
 * Appends a `model_mids` row for every live instrument whose mid or inputs
 * moved since its latest row. Pass the cron run's transaction and run id.
 */
export async function computeMids(
  db: Kysely<Database>,
  runId: string | null,
  now: Date = new Date(),
): Promise<ComputeMidsSummary> {
  const instruments = await liveInstruments(db);
  const flags = await flagsByCompany(db, [...new Set(instruments.map((i) => i.company_id))], now);
  const stored = await latestStoredMids(
    db,
    instruments.map((instrument) => instrument.id),
  );

  const mids: ComputeMidsSummary["mids"][number][] = [];
  const rows = [];
  for (const instrument of instruments) {
    const mid = computeMid(instrument, flags.get(instrument.company_id) ?? [], now);
    const written = !sameMid(stored.get(instrument.id), mid);
    if (written) {
      rows.push({
        instrument_id: instrument.id,
        model_version: MODEL_VERSION,
        rulebook_version: RULEBOOK_VERSION,
        computed_at: now,
        mid_ln: mid.kind === "forward" ? mid.value : null,
        p: mid.kind === "binary" ? mid.value : null,
        inputs_json: JSON.stringify(mid.inputs),
        run_id: runId,
      });
    }
    mids.push({
      instrument_id: instrument.id,
      kind: instrument.kind,
      company: instrument.company,
      value: mid.value,
      written,
    });
  }
  if (rows.length > 0) await db.insertInto("model_mids").values(rows).execute();
  return {
    instruments: instruments.length,
    mids_written: rows.length,
    unchanged: instruments.length - rows.length,
    mids,
  };
}
