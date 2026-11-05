/**
 * Form D ingest (docs/prompts/v2/p4-certificates-prints-spv.md, "SPVs"):
 * `npm run index:ingest -- --source=form_d`.
 *
 * 1. Full-text search finds every Form D (and D/A) whose text has one of an
 *    issuer's Form D phrases (`form_d.search_phrases`, else `search_phrases`).
 * 2. Each filing's primary_doc.xml is read once into `source_documents`
 *    (class `form_d`) when it is one of:
 *    - a vehicle: a pooled investment fund, or a name that says it is one
 *      (`isVehicle`). It becomes an `spv_vehicles` row, matched to the one
 *      watchlist issuer whose vehicle pattern (`form_d.vehicle_pattern`, else
 *      `match_pattern`) its name matches (`match_method = 'alias'`, the
 *      matching text in `match_note`). A vehicle whose name matches none, or
 *      more than one, is stored `unmatched`; nothing is guessed.
 *    - the issuer's own Form D: not a pooled fund, a name matching the
 *      issuer's `match_pattern` and no vehicle words. It sets the issuer's
 *      `incorporation_state` (the newest one's jurisdiction, with the filing
 *      as source), and stands as `prints` evidence of a round's size and
 *      date (`origin = 'form_d'`, `event_type = 'form_d_offering'`) where no
 *      events.csv print with a rank-1 or rank-2 source lies within 90 days.
 *    Anything else (an operating company whose Form D mentions the phrase)
 *    is counted and not stored.
 * 3. Stored vehicles not matched by hand are matched again on every run,
 *    so a pattern added to the watchlist reaches vehicles already stored.
 *
 * Idempotent: a filing is keyed by its accession and read once.
 */
import { createHash } from "node:crypto";

import { type Kysely, sql, type Transaction } from "kysely";

import type { Database } from "../../db/schema.js";
import { daysBetween } from "../../engine/index/mark.js";
import { sourceRank } from "../../engine/rulebook.js";
import { searchFullText } from "../../ingest/fetch/efts.js";
import { filingDocumentUrl, type SecClient } from "../../ingest/fetch/sec.js";
import { filingsFromHits } from "../../ingest/parse/efts.js";
import {
  FORM_D_PARSER_VERSION,
  type FormD,
  isVehicle,
  parseFormD,
} from "../../ingest/parse/form-d.js";
import { issuerPattern } from "../../ingest/parse/watchlist.js";
import type { IndexIssuer } from "./ingest-nport.js";
import { finishIngestRun, startIngestRun } from "./ingest-runs.js";

/** Days around a Form D's first sale within which an events.csv print of rank 1 or 2 makes it redundant. */
export const FORM_D_PRINT_WINDOW_DAYS = 90;
export const FORM_D_OFFERING = "form_d_offering";

/** Words in an issuer's name that make it a vehicle, not the company (unlike `Holdings`, which companies use). */
const VEHICLE_WORDS =
  /\b(?:SPV|SERIES|FUNDS?|CO-?INVEST\w*|SYNDICATE|FEEDER|INVESTORS?|PARTNERS|VENTURES|OPPORTUNIT(?:Y|IES)|CAPITAL|L\.?P\.?)\b/i;

export interface FormDCandidate {
  readonly url: string;
  readonly accession: string;
  readonly cik: string;
  readonly filerName: string;
  readonly form: string;
  readonly filedOn: string | null;
  /** Issuers whose phrases found the filing. */
  readonly foundBy: readonly string[];
}

export type FormDReading =
  | { readonly kind: "vehicle"; readonly issuerSlug: string | null; readonly note: string }
  | { readonly kind: "own"; readonly issuerSlug: string }
  | { readonly kind: "other" };

function vehiclePattern(issuer: IndexIssuer): RegExp {
  return issuerPattern(issuer.formD?.vehiclePattern ?? issuer.matchPattern);
}

/** What one Form D is to the watchlist: a vehicle (matched or not), an issuer's own, or neither. */
export function readFormD(
  form: Pick<FormD, "issuerName" | "industryGroup" | "coIssuers">,
  issuers: readonly IndexIssuer[],
  foundBy: readonly string[] = [],
): FormDReading {
  const pooled = form.industryGroup === "Pooled Investment Fund";
  if (!pooled && !VEHICLE_WORDS.test(form.issuerName)) {
    const own = issuers.find((issuer) => issuerPattern(issuer.matchPattern).test(form.issuerName));
    if (own !== undefined) return { kind: "own", issuerSlug: own.slug };
  }
  if (!isVehicle(form)) return { kind: "other" };
  const names = [form.issuerName, ...form.coIssuers.map((issuer) => issuer.name)];
  const matches = issuers.flatMap((issuer) => {
    const pattern = vehiclePattern(issuer);
    for (const name of names) {
      const text = pattern.exec(name)?.[0];
      if (text !== undefined) return [{ issuer, text, name }];
    }
    return [];
  });
  const found = foundBy.length === 0 ? "" : ` Found by full-text search for ${foundBy.join(", ")}.`;
  if (matches.length === 1) {
    const [{ issuer, text, name }] = matches as [(typeof matches)[number]];
    return {
      kind: "vehicle",
      issuerSlug: issuer.slug,
      note: `"${text}" in the vehicle name "${name}" matches ${issuer.slug}'s vehicle pattern /${issuer.formD?.vehiclePattern ?? issuer.matchPattern}/i.${found}`,
    };
  }
  if (matches.length > 1) {
    return {
      kind: "vehicle",
      issuerSlug: null,
      note: `The vehicle name names more than one watchlist issuer: ${matches.map((match) => `${match.issuer.slug} ("${match.text}")`).join(", ")}.${found}`,
    };
  }
  return {
    kind: "vehicle",
    issuerSlug: null,
    note: `No watchlist issuer's vehicle pattern matches the vehicle name.${found}`,
  };
}

/** Every Form D whose text has one of the issuers' Form D phrases, oldest filing first. */
export async function findFormDCandidates(
  client: SecClient,
  issuers: readonly IndexIssuer[],
  options: { readonly since: string; readonly until: string },
): Promise<FormDCandidate[]> {
  const byAccession = new Map<string, FormDCandidate & { foundBy: string[] }>();
  for (const issuer of issuers) {
    for (const phrase of issuer.formD?.searchPhrases ?? issuer.searchPhrases) {
      const { hits } = await searchFullText(client, {
        phrase,
        forms: ["D"],
        startDate: options.since,
        endDate: options.until,
      });
      for (const filing of filingsFromHits(hits)) {
        if (filing.cik.length === 0 || !filing.fileNames.includes("primary_doc.xml")) continue;
        const existing = byAccession.get(filing.accession);
        if (existing !== undefined) {
          if (!existing.foundBy.includes(issuer.slug)) existing.foundBy.push(issuer.slug);
          continue;
        }
        byAccession.set(filing.accession, {
          url: filingDocumentUrl(filing.cik, filing.accession, "primary_doc.xml"),
          accession: filing.accession,
          cik: filing.cik,
          filerName: filing.filerName,
          form: filing.form,
          filedOn: filing.filedOn,
          foundBy: [issuer.slug],
        });
      }
    }
  }
  return [...byAccession.values()].sort(
    (a, b) =>
      (a.filedOn ?? "").localeCompare(b.filedOn ?? "") || a.accession.localeCompare(b.accession),
  );
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function storeDocument(
  trx: Transaction<Database>,
  candidate: FormDCandidate,
  form: FormD,
  xml: string,
  rank: number,
  fetchedAt: Date,
): Promise<string> {
  const inserted = await trx
    .insertInto("source_documents")
    .values({
      source_class: "form_d",
      source_rank: rank,
      accession: candidate.accession,
      document_url: candidate.url,
      filer_cik: form.issuerCik,
      filer_name: form.issuerName,
      fund_series_id: null,
      fund_series_name: null,
      form_type: form.submissionType,
      filed_on: candidate.filedOn,
      period_end: null,
      fetched_at: fetchedAt,
      content_sha256: sha256(xml),
      parser_version: FORM_D_PARSER_VERSION,
    })
    .onConflict((conflict) => conflict.column("accession").doNothing())
    .returning("id")
    .executeTakeFirst();
  if (inserted !== undefined) return inserted.id;
  const existing = await trx
    .selectFrom("source_documents")
    .select("id")
    .where("accession", "=", candidate.accession)
    .executeTakeFirstOrThrow();
  return existing.id;
}

/** Round-history prints' source ranks, keyed `slug\u0000round name`. */
export type RoundSourceRanks = ReadonlyMap<string, number>;

async function recordOwnFiling(
  trx: Transaction<Database>,
  issuerId: string,
  issuerSlug: string,
  documentId: string,
  candidate: FormDCandidate,
  form: FormD,
  ranks: RoundSourceRanks,
): Promise<"evidence" | "redundant" | "updated"> {
  const filedOn = candidate.filedOn ?? form.signedOn;
  // The state of incorporation: the newest own Form D's jurisdiction, with the filing.
  if (form.jurisdiction !== null) {
    const issuer = await trx
      .selectFrom("issuers")
      .leftJoin("source_documents", "source_documents.id", "issuers.incorporation_source_id")
      .select(["source_documents.filed_on"])
      .where("issuers.id", "=", issuerId)
      .executeTakeFirstOrThrow();
    if (issuer.filed_on === null || (filedOn !== null && filedOn >= issuer.filed_on)) {
      await trx
        .updateTable("issuers")
        .set({ incorporation_state: form.jurisdiction, incorporation_source_id: documentId })
        .where("id", "=", issuerId)
        .execute();
    }
  }

  const announcedOn = form.firstSaleOn ?? filedOn;
  if (announcedOn === null) return "redundant";
  const nearby = await trx
    .selectFrom("prints")
    .select(["round_name", "announced_on"])
    .where("issuer_id", "=", issuerId)
    .where("origin", "=", "events.csv")
    .execute();
  const ranked = nearby.some(
    (print) =>
      Math.abs(daysBetween(announcedOn, print.announced_on)) <= FORM_D_PRINT_WINDOW_DAYS &&
      (ranks.get(`${issuerSlug}\u0000${print.round_name}`) ?? 99) <= 2,
  );
  if (ranked) return "redundant";

  const roundName =
    form.firstSaleOn === null
      ? `Form D ${candidate.accession}`
      : `Form D offering, first sale ${form.firstSaleOn}`;
  const sold =
    form.totalSoldUsd !== null && Number(form.totalSoldUsd) > 0 ? form.totalSoldUsd : null;
  const existing = await trx
    .selectFrom("prints")
    .leftJoin("source_documents", "source_documents.document_url", "prints.source_url")
    .select(["prints.id", "source_documents.filed_on"])
    .where("prints.issuer_id", "=", issuerId)
    .where("prints.round_name", "=", roundName)
    .executeTakeFirst();
  if (existing === undefined) {
    await trx
      .insertInto("prints")
      .values({
        issuer_id: issuerId,
        round_name: roundName,
        event_type: FORM_D_OFFERING,
        announced_on: announcedOn,
        amount_raised_usd: sold,
        source_url: candidate.url,
        origin: "form_d",
      })
      .execute();
    return "evidence";
  }
  // An amendment of the same offering restates its amounts: the newest filing's stand.
  if (existing.filed_on === null || (filedOn !== null && filedOn >= existing.filed_on)) {
    await trx
      .updateTable("prints")
      .set({ amount_raised_usd: sold, source_url: candidate.url })
      .where("id", "=", existing.id)
      .where("origin", "=", "form_d")
      .execute();
  }
  return "updated";
}

export interface FormDOutcome {
  readonly reading: FormDReading;
  readonly stored: boolean;
  readonly evidence?: "evidence" | "redundant" | "updated";
}

/** Parses one fetched Form D and stores what it is, in one transaction. */
export async function ingestFormDDocument(
  db: Kysely<Database>,
  candidate: FormDCandidate,
  xml: string,
  issuers: readonly IndexIssuer[],
  fetchedAt: Date,
  ranks: RoundSourceRanks = new Map(),
): Promise<FormDOutcome> {
  const form = parseFormD(xml);
  const reading = readFormD(form, issuers, candidate.foundBy);
  if (reading.kind === "other") return { reading, stored: false };
  const issuerIds = new Map(issuers.map((issuer) => [issuer.slug, issuer.id]));
  return db.transaction().execute(async (trx) => {
    if (reading.kind === "own") {
      const documentId = await storeDocument(
        trx,
        candidate,
        form,
        xml,
        sourceRank("form_d", "round_size_and_date"),
        fetchedAt,
      );
      const evidence = await recordOwnFiling(
        trx,
        issuerIds.get(reading.issuerSlug)!,
        reading.issuerSlug,
        documentId,
        candidate,
        form,
        ranks,
      );
      return { reading, stored: true, evidence };
    }
    const documentId = await storeDocument(
      trx,
      candidate,
      form,
      xml,
      sourceRank("form_d"),
      fetchedAt,
    );
    await trx
      .insertInto("spv_vehicles")
      .values({
        document_id: documentId,
        issuer_id: reading.issuerSlug === null ? null : issuerIds.get(reading.issuerSlug)!,
        vehicle_name: form.issuerName,
        vehicle_cik: form.issuerCik,
        related_persons: JSON.stringify(form.relatedPersons),
        jurisdiction: form.jurisdiction,
        total_offering_usd: form.totalOfferingUsd,
        total_sold_usd: form.totalSoldUsd,
        min_investment_usd: form.minInvestmentUsd,
        sales_commission_usd: form.salesCommissionUsd,
        finders_fee_usd: form.findersFeeUsd,
        first_sale_on: form.firstSaleOn,
        match_method: reading.issuerSlug === null ? "unmatched" : "alias",
        match_note: reading.note,
      })
      .onConflict((conflict) => conflict.column("document_id").doNothing())
      .execute();
    return { reading, stored: true };
  });
}

/** Matches stored vehicles again (never one matched by hand); returns how many changed. */
export async function rematchVehicles(
  db: Kysely<Database>,
  issuers: readonly IndexIssuer[],
): Promise<number> {
  const vehicles = await db
    .selectFrom("spv_vehicles")
    .select(["id", "vehicle_name", "issuer_id", "match_note"])
    .where("match_method", "<>", "manual")
    .execute();
  const ids = new Map(issuers.map((issuer) => [issuer.slug, issuer.id]));
  let changed = 0;
  for (const vehicle of vehicles) {
    const found = /Found by full-text search for ([^.]+)\./.exec(vehicle.match_note ?? "")?.[1];
    const reading = readFormD(
      { issuerName: vehicle.vehicle_name, industryGroup: "Pooled Investment Fund", coIssuers: [] },
      issuers,
      found === undefined ? [] : found.split(", "),
    );
    if (reading.kind !== "vehicle") continue;
    const issuerId = reading.issuerSlug === null ? null : ids.get(reading.issuerSlug)!;
    if (issuerId === vehicle.issuer_id) continue;
    await db
      .updateTable("spv_vehicles")
      .set({
        issuer_id: issuerId,
        match_method: issuerId === null ? "unmatched" : "alias",
        match_note: reading.note,
      })
      .where("id", "=", vehicle.id)
      .execute();
    changed += 1;
  }
  return changed;
}

export interface IssuerFormDCounts {
  candidates: number;
  vehiclesMatched: number;
  vehiclesUnmatched: number;
  ownFilings: number;
  notVehicles: number;
}

export interface IngestFormDReport {
  readonly runId: string;
  readonly status: "ok" | "failed";
  readonly error: string | null;
  readonly candidates: number;
  readonly documentsSeen: number;
  readonly documentsNew: number;
  readonly documentsSkipped: number;
  readonly rematched: number;
  /** Per issuer whose phrases found the filing (a filing found by two counts for both). */
  readonly perIssuer: Readonly<Record<string, IssuerFormDCounts>>;
  readonly failures: readonly { readonly url: string; readonly reason: string }[];
}

export interface IngestFormDOptions {
  readonly since: string;
  readonly until: string;
  readonly issuers: readonly IndexIssuer[];
  readonly roundSourceRanks?: RoundSourceRanks;
  readonly candidates?: readonly FormDCandidate[];
  readonly deadlineMs?: number;
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tallyOutcome(
  counts: Record<string, IssuerFormDCounts>,
  candidate: FormDCandidate,
  outcome: FormDOutcome,
): void {
  for (const slug of candidate.foundBy) {
    const count = counts[slug];
    if (count === undefined) continue;
    if (outcome.reading.kind === "other") count.notVehicles += 1;
    else if (outcome.reading.kind === "own") count.ownFilings += 1;
    else if (outcome.reading.issuerSlug === null) count.vehiclesUnmatched += 1;
    else if (outcome.reading.issuerSlug === slug) count.vehiclesMatched += 1;
  }
}

/** One run of the Form D source: search, read what is new, match, record the run. */
export async function ingestFormD(
  db: Kysely<Database>,
  client: SecClient,
  options: IngestFormDOptions,
): Promise<IngestFormDReport> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const runId = await startIngestRun(db, "form_d", now());
  const perIssuer: Record<string, IssuerFormDCounts> = {};
  for (const issuer of options.issuers) {
    perIssuer[issuer.slug] = {
      candidates: 0,
      vehiclesMatched: 0,
      vehiclesUnmatched: 0,
      ownFilings: 0,
      notVehicles: 0,
    };
  }
  const failures: { url: string; reason: string }[] = [];
  let candidates: readonly FormDCandidate[] = [];
  let documentsSeen = 0;
  let documentsNew = 0;
  let documentsSkipped = 0;
  let rematched = 0;
  let error: string | null = null;
  try {
    candidates =
      options.candidates ?? (await findFormDCandidates(client, options.issuers, options));
    for (const candidate of candidates) {
      for (const slug of candidate.foundBy) {
        if (perIssuer[slug] !== undefined) perIssuer[slug].candidates += 1;
      }
    }
    const stored = new Set(
      (
        await db
          .selectFrom("source_documents")
          .select("accession")
          .where("source_class", "=", "form_d")
          .execute()
      ).map((row) => row.accession),
    );
    const queue = candidates.filter((candidate) => !stored.has(candidate.accession));
    documentsSkipped = candidates.length - queue.length;
    log(`form_d: ${candidates.length} filings, ${queue.length} to read`);
    for (const [position, candidate] of queue.entries()) {
      if (options.deadlineMs !== undefined && now().getTime() >= options.deadlineMs) {
        error = `stopped at the time limit with ${queue.length - position} filings left; the next run resumes them`;
        break;
      }
      documentsSeen += 1;
      try {
        const xml = await client.text(candidate.url);
        const outcome = await ingestFormDDocument(
          db,
          candidate,
          xml,
          options.issuers,
          now(),
          options.roundSourceRanks,
        );
        if (outcome.stored) documentsNew += 1;
        tallyOutcome(perIssuer, candidate, outcome);
      } catch (failure) {
        failures.push({ url: candidate.url, reason: errorText(failure) });
      }
      if ((position + 1) % 100 === 0) log(`form_d: ${position + 1} of ${queue.length} read`);
    }
    rematched = await rematchVehicles(db, options.issuers);
  } catch (runError) {
    error = errorText(runError);
  }
  const status = error === null ? "ok" : "failed";
  const note =
    error ??
    (failures.length === 0
      ? null
      : `${failures.length} filings unread: ${failures
          .slice(0, 5)
          .map((failure) => `${failure.url} (${failure.reason})`)
          .join("; ")}`.slice(0, 2_000));
  await finishIngestRun(db, runId, {
    documentsSeen: documentsSeen + documentsSkipped,
    documentsNew,
    marksNew: 0,
    status,
    error: note,
    finishedAt: now(),
  });
  return {
    runId,
    status,
    error,
    candidates: candidates.length,
    documentsSeen: documentsSeen + documentsSkipped,
    documentsNew,
    documentsSkipped,
    rematched,
    perIssuer,
    failures,
  };
}

/** Live counts of stored vehicles per issuer (unmatched under null). */
export async function vehicleCounts(
  db: Kysely<Database>,
): Promise<{ issuer: string | null; method: string; vehicles: number; filings: number }[]> {
  const rows = await db
    .selectFrom("spv_vehicles")
    .leftJoin("issuers", "issuers.id", "spv_vehicles.issuer_id")
    .select([
      "issuers.slug as issuer",
      "spv_vehicles.match_method as method",
      sql<string>`count(distinct spv_vehicles.vehicle_cik)`.as("vehicles"),
      sql<string>`count(*)`.as("filings"),
    ])
    .groupBy(["issuers.slug", "spv_vehicles.match_method"])
    .orderBy("issuers.slug")
    .execute();
  return rows.map((row) => ({
    issuer: row.issuer,
    method: row.method,
    vehicles: Number(row.vehicles),
    filings: Number(row.filings),
  }));
}
