/**
 * `npm run index:prints`: the round-history dataset's prints
 * (data/round-history/events.csv rows of event type `priced_round` or `ipo`)
 * for watchlist issuers into `prints`, `origin = 'events.csv'`, with the
 * source URL sources.csv gives the round. Idempotent on (issuer, round): a
 * stored print is never rewritten; one whose figures differ from the file is
 * reported, for a correction.
 *
 * A company is the watchlist issuer whose name it is, or whose name gives it
 * in parentheses (`Anysphere (Cursor)` is `Cursor`).
 */
import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import { parseCsv } from "../../tradeables/csv.js";
import { PRINT_EVENT_TYPES } from "./import-certificates.js";

export interface PrintCandidate {
  readonly issuerSlug: string;
  readonly roundName: string;
  readonly eventType: string;
  readonly announcedOn: string;
  readonly postMoneyUsd: string | null;
  readonly amountRaisedUsd: string | null;
  readonly sourceUrl: string | null;
  /** sources.csv's rank for the round's source; null without a source row. */
  readonly sourceRank: number | null;
}

export interface PrintsImportReport {
  readonly inserted: number;
  readonly unchanged: number;
  /** Stored prints whose figures the file now states differently: a correction, not an update. */
  readonly differing: readonly { readonly issuer: string; readonly roundName: string }[];
  /** Companies in the dataset with no watchlist issuer. */
  readonly unmatchedCompanies: readonly string[];
}

/** Decimal text as the CSV writes it (`300000000.0`), normalized; empty is null. */
function amount(text: string | undefined): string | null {
  const value = (text ?? "").trim();
  if (value === "") return null;
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`not an amount: ${value}`);
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function companyKey(company: string, roundName: string): string {
  return `${company}\u0000${roundName}`;
}

/** The issuer a dataset company is, by name or the name's parenthetical. */
export function issuerForCompany(
  company: string,
  issuers: readonly { readonly slug: string; readonly name: string }[],
): string | null {
  const found = issuers.find(
    (issuer) =>
      issuer.name === company || /\(([^)]+)\)\s*$/.exec(issuer.name)?.[1]?.trim() === company,
  );
  return found?.slug ?? null;
}

/** The dataset's prints for `issuers`, from the two files' text. */
export function printCandidates(
  eventsCsv: string,
  sourcesCsv: string,
  issuers: readonly { readonly slug: string; readonly name: string }[],
): { candidates: PrintCandidate[]; unmatchedCompanies: string[] } {
  const sources = new Map(
    parseCsv(sourcesCsv).map((row) => [companyKey(row.company ?? "", row.round_name ?? ""), row]),
  );
  const candidates: PrintCandidate[] = [];
  const unmatched = new Set<string>();
  for (const row of parseCsv(eventsCsv)) {
    const eventType = row.event_type ?? "";
    if (!(PRINT_EVENT_TYPES as readonly string[]).includes(eventType)) continue;
    const company = row.company ?? "";
    const issuerSlug = issuerForCompany(company, issuers);
    if (issuerSlug === null) {
      unmatched.add(company);
      continue;
    }
    const source = sources.get(companyKey(company, row.round_name ?? ""));
    candidates.push({
      issuerSlug,
      roundName: row.round_name ?? "",
      eventType,
      announcedOn: row.announcement_date ?? "",
      postMoneyUsd: amount(row.post_money_usd),
      amountRaisedUsd: amount(row.amount_raised_usd),
      sourceUrl: source?.source_url ? source.source_url : null,
      sourceRank: source?.source_rank ? Number(source.source_rank) : null,
    });
  }
  return { candidates, unmatchedCompanies: [...unmatched].sort() };
}

function sameNumber(stored: string | null, filed: string | null): boolean {
  if (stored === null || filed === null) return stored === filed;
  return Number(stored) === Number(filed);
}

export async function importPrints(
  db: Kysely<Database>,
  candidates: readonly PrintCandidate[],
  unmatchedCompanies: readonly string[] = [],
): Promise<PrintsImportReport> {
  return db.transaction().execute(async (trx) => {
    const issuers = new Map(
      (await trx.selectFrom("issuers").select(["id", "slug"]).execute()).map((row) => [
        row.slug,
        row.id,
      ]),
    );
    let inserted = 0;
    let unchanged = 0;
    const differing: { issuer: string; roundName: string }[] = [];
    for (const candidate of candidates) {
      const issuerId = issuers.get(candidate.issuerSlug);
      if (issuerId === undefined) throw new Error(`no issuer ${candidate.issuerSlug}`);
      const row = await trx
        .insertInto("prints")
        .values({
          issuer_id: issuerId,
          round_name: candidate.roundName,
          event_type: candidate.eventType,
          announced_on: candidate.announcedOn,
          post_money_usd: candidate.postMoneyUsd,
          amount_raised_usd: candidate.amountRaisedUsd,
          source_url: candidate.sourceUrl,
          origin: "events.csv",
        })
        .onConflict((conflict) => conflict.columns(["issuer_id", "round_name"]).doNothing())
        .returning("id")
        .executeTakeFirst();
      if (row !== undefined) {
        inserted += 1;
        continue;
      }
      const stored = await trx
        .selectFrom("prints")
        .selectAll()
        .where("issuer_id", "=", issuerId)
        .where("round_name", "=", candidate.roundName)
        .executeTakeFirstOrThrow();
      const same =
        stored.event_type === candidate.eventType &&
        stored.announced_on === candidate.announcedOn &&
        sameNumber(stored.post_money_usd, candidate.postMoneyUsd) &&
        sameNumber(stored.amount_raised_usd, candidate.amountRaisedUsd) &&
        stored.source_url === candidate.sourceUrl;
      if (same) unchanged += 1;
      else differing.push({ issuer: candidate.issuerSlug, roundName: candidate.roundName });
    }
    return { inserted, unchanged, differing, unmatchedCompanies };
  });
}
