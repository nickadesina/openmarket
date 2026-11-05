/**
 * N-PORT ingest (docs/prompts/v2/p2-edgar-ingest.md, step 6): every NPORT-P
 * (and NPORT-P/A) whose primary document names an issuer is fetched once,
 * stored as a `source_documents` row (class `nport`), and each holding whose
 * name or title matches an issuer's `match_pattern` becomes a `filer_marks`
 * row as filed: value, balance, units, and `value / balance` as the
 * per-share mark when the balance is shares. Nothing is adjusted.
 *
 * Idempotent: a document is keyed by (document_url, content_sha256) and a
 * mark by (document, issuer, holding index), so a rerun inserts nothing
 * twice. A document already stored with marks for every issuer the search
 * attributes to it is not fetched again.
 *
 * Supersession: an amendment replaces its fund's report for the period. For
 * each issuer, the live marks of every earlier filing for the same series
 * (or registrant, without one) and report date point `superseded_by` at the
 * newest filing's mark for the same holding (same name and title, else the
 * same label, else its first mark for the issuer).
 */
import { createHash } from "node:crypto";

import { type Kysely, sql, type Transaction } from "kysely";

import type { Database, IndexSourceClass } from "../../db/schema.js";
import { classifySecurity } from "../../engine/index/series.js";
import { sourceRank } from "../../engine/rulebook.js";
import { nportPrimaryDocumentUrl, type SecClient } from "../../ingest/fetch/sec.js";
import {
  matchingHoldings,
  NPORT_PARSER_VERSION,
  type NportDocument,
  type NportHolding,
  parseNport,
} from "../../ingest/parse/nport.js";
import { issuerPattern, type WatchlistIssuer } from "../../ingest/parse/watchlist.js";
import { finishIngestRun, startIngestRun } from "./ingest-runs.js";
import { searchIssuerForm } from "./search-filings.js";

const SOURCE_CLASS: IndexSourceClass = "nport";

export interface IndexIssuer extends WatchlistIssuer {
  readonly id: string;
}

/** One N-PORT primary document the search found, and the issuers it named. */
export interface NportCandidate {
  readonly url: string;
  readonly accession: string;
  readonly cik: string;
  readonly filerName: string;
  readonly form: string;
  readonly filedOn: string | null;
  readonly issuerSlugs: readonly string[];
}

export interface IngestNportOptions {
  readonly since: string;
  readonly until: string;
  /** Only these issuers; default every watchlisted issuer. */
  readonly issuerSlugs?: readonly string[];
  /** Stop before starting another document once `now()` passes this (epoch ms). */
  readonly deadlineMs?: number;
  /** Skip the search and ingest these (tests, reruns). */
  readonly candidates?: readonly NportCandidate[];
  /**
   * Read every candidate again, even one with marks for every issuer the
   * search names: after a watchlist pattern changes, a stored document can
   * hold holdings of an issuer its search did not attribute to it (P2's xAI
   * fix). Rows already stored are not written twice.
   */
  readonly refetch?: boolean;
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
}

export interface IssuerIngestCounts {
  documents: number;
  marks: number;
  perShareMarks: number;
}

export interface IngestNportReport {
  readonly runId: string;
  readonly status: "ok" | "failed";
  readonly error: string | null;
  readonly candidates: number;
  readonly documentsSeen: number;
  readonly documentsNew: number;
  readonly documentsSkipped: number;
  readonly marksNew: number;
  readonly supersededNew: number;
  /** Documents whose text has an issuer's phrase but no holding matches its pattern. */
  readonly phraseOnly: readonly { readonly url: string; readonly issuerSlug: string }[];
  readonly failures: readonly { readonly url: string; readonly reason: string }[];
  readonly perIssuer: Readonly<Record<string, IssuerIngestCounts>>;
}

export async function loadIndexIssuers(
  db: Kysely<Database>,
  slugs?: readonly string[],
): Promise<IndexIssuer[]> {
  let query = db.selectFrom("issuers").selectAll().orderBy("slug");
  query =
    slugs === undefined || slugs.length === 0
      ? query.where("watchlisted", "=", true)
      : query.where("slug", "in", [...slugs]);
  const rows = await query.execute();
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name,
    searchPhrases: row.search_phrases,
    matchPattern: row.match_pattern,
    watchlisted: row.watchlisted,
  }));
}

/** The N-PORT primary documents that name any of `issuers`, oldest filing first. */
export async function findNportCandidates(
  client: SecClient,
  issuers: readonly WatchlistIssuer[],
  options: { since: string; until: string },
): Promise<NportCandidate[]> {
  const byUrl = new Map<string, NportCandidate & { issuerSlugs: string[] }>();
  for (const issuer of issuers) {
    const { filings } = await searchIssuerForm(client, issuer, "NPORT-P", {
      startDate: options.since,
      endDate: options.until,
    });
    for (const filing of filings) {
      if (!filing.fileNames.includes("primary_doc.xml")) continue;
      const url = nportPrimaryDocumentUrl(filing.cik, filing.accession);
      const existing = byUrl.get(url);
      if (existing === undefined) {
        byUrl.set(url, {
          url,
          accession: filing.accession,
          cik: filing.cik,
          filerName: filing.filerName,
          form: filing.form,
          filedOn: filing.filedOn,
          issuerSlugs: [issuer.slug],
        });
      } else if (!existing.issuerSlugs.includes(issuer.slug)) {
        existing.issuerSlugs.push(issuer.slug);
      }
    }
  }
  return [...byUrl.values()].sort(
    (a, b) =>
      (a.filedOn ?? "").localeCompare(b.filedOn ?? "") || a.accession.localeCompare(b.accession),
  );
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Whether every issuer the search names in this document already has a mark from it. */
async function alreadyIngested(
  db: Kysely<Database>,
  candidate: NportCandidate,
  issuerIds: ReadonlyMap<string, string>,
): Promise<boolean> {
  const ids = candidate.issuerSlugs
    .map((slug) => issuerIds.get(slug))
    .filter((id) => id !== undefined);
  if (ids.length === 0) return false;
  const rows = await db
    .selectFrom("filer_marks")
    .innerJoin("source_documents", "source_documents.id", "filer_marks.document_id")
    .select("filer_marks.issuer_id")
    .distinct()
    .where("source_documents.document_url", "=", candidate.url)
    .where("filer_marks.issuer_id", "in", ids)
    .execute();
  return rows.length === ids.length;
}

async function storeDocument(
  trx: Transaction<Database>,
  candidate: NportCandidate,
  document: NportDocument,
  contentSha256: string,
  fetchedAt: Date,
): Promise<{ id: string; isNew: boolean }> {
  const inserted = await trx
    .insertInto("source_documents")
    .values({
      source_class: SOURCE_CLASS,
      source_rank: sourceRank(SOURCE_CLASS),
      accession: candidate.accession,
      document_url: candidate.url,
      filer_cik: document.registrantCik ?? candidate.cik,
      filer_name: document.registrantName || candidate.filerName,
      fund_series_id: document.seriesId,
      fund_series_name: document.seriesName,
      form_type: document.submissionType ?? candidate.form,
      filed_on: candidate.filedOn,
      period_end: document.reportDate,
      fetched_at: fetchedAt,
      content_sha256: contentSha256,
      parser_version: NPORT_PARSER_VERSION,
    })
    .onConflict((conflict) => conflict.doNothing())
    .returning("id")
    .executeTakeFirst();
  if (inserted !== undefined) return { id: inserted.id, isNew: true };
  const existing = await trx
    .selectFrom("source_documents")
    .select("id")
    .where("document_url", "=", candidate.url)
    .where("content_sha256", "=", contentSha256)
    .executeTakeFirst();
  if (existing === undefined) {
    throw new Error(`accession ${candidate.accession} is stored with different content`);
  }
  return { id: existing.id, isNew: false };
}

async function storeMarks(
  trx: Transaction<Database>,
  documentId: string,
  issuer: IndexIssuer,
  holdings: readonly NportHolding[],
  asOf: string,
): Promise<{ marks: number; perShare: number }> {
  let marks = 0;
  let perShare = 0;
  for (const holding of holdings) {
    if (holding.valueUsd === null) continue;
    const { label, kind } = classifySecurity(holding.title, holding.name, holding.assetCategory);
    const isShares =
      holding.units === "NS" &&
      holding.balance !== null &&
      Number(holding.balance) > 0 &&
      Number(holding.valueUsd) >= 0;
    const inserted = await trx
      .insertInto("filer_marks")
      .values({
        document_id: documentId,
        issuer_id: issuer.id,
        holding_index: holding.index,
        holding_name: holding.name,
        holding_title: holding.title,
        asset_category: holding.assetCategory,
        security_label: label,
        security_kind: kind,
        balance: holding.balance,
        units: holding.units,
        value_usd: holding.valueUsd,
        // numeric division in PostgreSQL: the mark never passes through a float.
        mark_per_share_usd: isShares
          ? sql<string>`${holding.valueUsd}::numeric / ${holding.balance}::numeric`
          : null,
        fair_value_level: holding.fairValueLevel,
        is_restricted: holding.isRestricted,
        as_of: asOf,
      })
      // A holding is stored once as filed; corrections add rows beside it (migration 021).
      .onConflict((conflict) =>
        conflict
          .columns(["document_id", "issuer_id", "holding_index"])
          .where("correction_id", "is", null)
          .doNothing(),
      )
      .returning("id")
      .executeTakeFirst();
    if (inserted !== undefined) {
      marks += 1;
      if (isShares) perShare += 1;
    }
  }
  return { marks, perShare };
}

/**
 * Points every live mark of `issuerId` from an earlier filing of the same
 * fund and report date at the newest filing's matching mark. Returns how many
 * rows it superseded.
 */
export async function resolveSupersession(
  trx: Transaction<Database>,
  issuerId: string,
  fund: { readonly seriesId: string | null; readonly cik: string | null },
  periodEnd: string,
): Promise<number> {
  let documentsQuery = trx
    .selectFrom("source_documents")
    .select(["id"])
    .where("source_class", "=", SOURCE_CLASS)
    .where("period_end", "=", periodEnd);
  documentsQuery =
    fund.seriesId === null
      ? documentsQuery.where("fund_series_id", "is", null).where("filer_cik", "=", fund.cik)
      : documentsQuery.where("fund_series_id", "=", fund.seriesId);
  const documents = await documentsQuery
    .orderBy(sql`filed_on desc nulls last`)
    .orderBy("accession", "desc")
    .execute();
  if (documents.length < 2) return 0;
  const [newest, ...older] = documents;
  const replacements = await trx
    .selectFrom("filer_marks")
    .select(["id", "holding_name", "holding_title", "security_label"])
    .where("document_id", "=", newest!.id)
    .where("issuer_id", "=", issuerId)
    .where("superseded_by", "is", null)
    .orderBy("holding_index")
    .execute();
  if (replacements.length === 0) return 0;
  const stale = await trx
    .selectFrom("filer_marks")
    .select(["id", "holding_name", "holding_title", "security_label"])
    .where(
      "document_id",
      "in",
      older.map((document) => document.id),
    )
    .where("issuer_id", "=", issuerId)
    .where("superseded_by", "is", null)
    .execute();
  for (const mark of stale) {
    const target =
      replacements.find(
        (row) => row.holding_name === mark.holding_name && row.holding_title === mark.holding_title,
      ) ??
      replacements.find((row) => row.security_label === mark.security_label) ??
      replacements[0]!;
    await trx
      .updateTable("filer_marks")
      .set({ superseded_by: target.id })
      .where("id", "=", mark.id)
      .execute();
  }
  return stale.length;
}

export interface DocumentOutcome {
  readonly isNew: boolean;
  readonly marksByIssuer: ReadonlyMap<string, { marks: number; perShare: number; matched: number }>;
  readonly superseded: number;
}

/** Parses one fetched N-PORT and stores it and its marks for `issuers`, in one transaction. */
export async function ingestNportDocument(
  db: Kysely<Database>,
  candidate: NportCandidate,
  xml: string,
  issuers: readonly IndexIssuer[],
  fetchedAt: Date,
): Promise<DocumentOutcome> {
  const document = parseNport(xml);
  const contentSha256 = sha256(xml);
  return db.transaction().execute(async (trx) => {
    const stored = await storeDocument(trx, candidate, document, contentSha256, fetchedAt);
    const marksByIssuer = new Map<string, { marks: number; perShare: number; matched: number }>();
    let superseded = 0;
    for (const issuer of issuers) {
      const holdings = matchingHoldings(document, issuerPattern(issuer.matchPattern));
      const written = await storeMarks(trx, stored.id, issuer, holdings, document.reportDate);
      marksByIssuer.set(issuer.slug, { ...written, matched: holdings.length });
      if (holdings.length > 0) {
        superseded += await resolveSupersession(
          trx,
          issuer.id,
          { seriesId: document.seriesId, cik: document.registrantCik ?? candidate.cik },
          document.reportDate,
        );
      }
    }
    return { isNew: stored.isNew, marksByIssuer, superseded };
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface RunTally {
  documentsSeen: number;
  documentsNew: number;
  documentsSkipped: number;
  marksNew: number;
  supersededNew: number;
  readonly perIssuer: Record<string, IssuerIngestCounts>;
  readonly phraseOnly: { url: string; issuerSlug: string }[];
  readonly failures: { url: string; reason: string }[];
}

/** Splits the candidates into already ingested, never stored, and stored but incomplete. */
async function triage(
  db: Kysely<Database>,
  candidates: readonly NportCandidate[],
  issuerIds: ReadonlyMap<string, string>,
  refetch: boolean,
): Promise<{ skipped: number; queue: NportCandidate[] }> {
  const unseen: NportCandidate[] = [];
  const incomplete: NportCandidate[] = [];
  let skipped = 0;
  for (const candidate of candidates) {
    if (!refetch && (await alreadyIngested(db, candidate, issuerIds))) {
      skipped += 1;
      continue;
    }
    const known = await db
      .selectFrom("source_documents")
      .select("id")
      .where("document_url", "=", candidate.url)
      .executeTakeFirst();
    (known === undefined ? unseen : incomplete).push(candidate);
  }
  // Unseen documents first, so a run stopped by the deadline still advances.
  return { skipped, queue: [...unseen, ...incomplete] };
}

async function fetchAndIngest(
  db: Kysely<Database>,
  client: SecClient,
  candidate: NportCandidate,
  issuers: readonly IndexIssuer[],
  fetchedAt: Date,
  tally: RunTally,
): Promise<void> {
  let xml: string;
  let outcome: DocumentOutcome;
  try {
    xml = await client.text(candidate.url);
    outcome = await ingestNportDocument(db, candidate, xml, issuers, fetchedAt);
  } catch (failure) {
    tally.failures.push({ url: candidate.url, reason: errorText(failure) });
    return;
  }
  if (outcome.isNew) tally.documentsNew += 1;
  tally.supersededNew += outcome.superseded;
  for (const [slug, written] of outcome.marksByIssuer) {
    const counts = tally.perIssuer[slug]!;
    if (written.matched > 0) counts.documents += 1;
    counts.marks += written.marks;
    counts.perShareMarks += written.perShare;
    tally.marksNew += written.marks;
    if (written.matched === 0 && candidate.issuerSlugs.includes(slug)) {
      tally.phraseOnly.push({ url: candidate.url, issuerSlug: slug });
    }
  }
}

/** One run of the N-PORT source: search, fetch, store, record the run. */
export async function ingestNport(
  db: Kysely<Database>,
  client: SecClient,
  options: IngestNportOptions,
): Promise<IngestNportReport> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const runId = await startIngestRun(db, SOURCE_CLASS, now());
  const tally: RunTally = {
    documentsSeen: 0,
    documentsNew: 0,
    documentsSkipped: 0,
    marksNew: 0,
    supersededNew: 0,
    perIssuer: {},
    phraseOnly: [],
    failures: [],
  };
  let candidates: readonly NportCandidate[] = [];
  let error: string | null = null;

  try {
    const issuers = await loadIndexIssuers(db, options.issuerSlugs);
    for (const issuer of issuers) {
      tally.perIssuer[issuer.slug] = { documents: 0, marks: 0, perShareMarks: 0 };
    }
    candidates =
      options.candidates ??
      (await findNportCandidates(client, issuers, { since: options.since, until: options.until }));
    const { skipped, queue } = await triage(
      db,
      candidates,
      new Map(issuers.map((issuer) => [issuer.slug, issuer.id])),
      options.refetch === true,
    );
    tally.documentsSkipped = skipped;
    tally.documentsSeen = skipped;
    log(
      `nport: ${candidates.length} documents for ${issuers.length} issuers, ${queue.length} to read`,
    );

    for (const [position, candidate] of queue.entries()) {
      if (options.deadlineMs !== undefined && now().getTime() >= options.deadlineMs) {
        error = `stopped at the time limit with ${queue.length - position} documents left; the next run resumes them`;
        break;
      }
      tally.documentsSeen += 1;
      await fetchAndIngest(db, client, candidate, issuers, now(), tally);
      if ((position + 1) % 100 === 0) {
        log(`nport: ${position + 1} of ${queue.length} read, ${tally.marksNew} new marks`);
      }
    }
  } catch (runError) {
    error = errorText(runError);
  }

  const status = error === null ? "ok" : "failed";
  // An ok run notes the documents it could not read; the next run retries them.
  const note =
    error ??
    (tally.failures.length === 0
      ? null
      : `${tally.failures.length} documents unread: ${tally.failures
          .slice(0, 5)
          .map((failure) => `${failure.url} (${failure.reason})`)
          .join("; ")}`.slice(0, 2_000));
  await finishIngestRun(db, runId, { ...tally, status, error: note, finishedAt: now() });
  return {
    runId,
    status,
    error,
    candidates: candidates.length,
    ...tally,
  };
}
