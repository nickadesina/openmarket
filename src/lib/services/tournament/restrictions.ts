import type { Kysely } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type { Database } from "../../db/schema.js";
import type { TournamentDb } from "./records.js";

/**
 * Restricted persons (CONTRACTS.md, README D12): a forecaster attests which
 * listed names they are employed by, a director of, or invested in, and
 * those names' contracts are refused to them at the quote and trade
 * services. Play money, so the attestation is self-reported and unverified
 * (KYC later). Each save appends an attestation; the latest is in force,
 * and the history stays.
 */

export interface RestrictableCompany {
  readonly slug: string;
  readonly name: string;
}

export interface Restrictions {
  /** When the attestation in force was made; null if the forecaster never made one. */
  readonly attested_at: Date | null;
  /** Company slugs of the attestation in force. */
  readonly restricted: readonly string[];
  /** The names a forecaster can attest to: every actively listed company. */
  readonly listed: readonly RestrictableCompany[];
}

async function listedCompanies(db: TournamentDb): Promise<RestrictableCompany[]> {
  return db
    .selectFrom("listings")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .select(["companies.slug", "companies.name"])
    .where("listings.delisted_at", "is", null)
    .orderBy("companies.name")
    .execute();
}

async function latestAttestation(db: TournamentDb, tournamentUserId: string) {
  return db
    .selectFrom("tournament_restriction_attestations")
    .select(["id", "attested_at"])
    .where("user_id", "=", tournamentUserId)
    .orderBy("attested_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
}

/** Company ids and slugs of the forecaster's attestation in force. */
export async function restrictedCompanies(
  db: TournamentDb,
  tournamentUserId: string,
): Promise<{ readonly id: string; readonly slug: string; readonly name: string }[]> {
  const latest = await latestAttestation(db, tournamentUserId);
  if (latest === undefined) return [];
  return db
    .selectFrom("tournament_restriction_companies as restricted")
    .innerJoin("companies", "companies.id", "restricted.company_id")
    .select(["companies.id", "companies.slug", "companies.name"])
    .where("restricted.attestation_id", "=", latest.id)
    .orderBy("companies.slug")
    .execute();
}

export async function getRestrictions(
  db: Kysely<Database>,
  tournamentUserId: string,
): Promise<Restrictions> {
  const latest = await latestAttestation(db, tournamentUserId);
  return {
    attested_at: latest?.attested_at ?? null,
    restricted: (await restrictedCompanies(db, tournamentUserId)).map((company) => company.slug),
    listed: await listedCompanies(db),
  };
}

/**
 * Appends an attestation naming exactly these listed companies (none clears
 * every restriction). An unchanged list appends nothing.
 */
export async function attestRestrictions(
  db: Kysely<Database>,
  tournamentUserId: string,
  slugs: readonly string[],
): Promise<Restrictions> {
  await db.transaction().execute(async (transaction) => {
    // One attestation at a time per forecaster, so the latest is well defined.
    await transaction
      .selectFrom("tournament_users")
      .select("id")
      .where("id", "=", tournamentUserId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const wanted = [...new Set(slugs)].sort();
    const companies =
      wanted.length === 0
        ? []
        : await transaction
            .selectFrom("listings")
            .innerJoin("companies", "companies.id", "listings.company_id")
            .select(["companies.id", "companies.slug"])
            .where("listings.delisted_at", "is", null)
            .where("companies.slug", "in", wanted)
            .execute();
    if (companies.length !== wanted.length) {
      throw new ServiceError("INVALID_INPUT", "Restrictions name listed companies only.");
    }
    const latest = await latestAttestation(transaction, tournamentUserId);
    const current = (await restrictedCompanies(transaction, tournamentUserId)).map(
      (company) => company.slug,
    );
    if (latest !== undefined && current.join(",") === wanted.join(",")) return;
    const attestation = await transaction
      .insertInto("tournament_restriction_attestations")
      .values({ user_id: tournamentUserId })
      .returning("id")
      .executeTakeFirstOrThrow();
    if (companies.length > 0) {
      await transaction
        .insertInto("tournament_restriction_companies")
        .values(
          companies.map((company) => ({ attestation_id: attestation.id, company_id: company.id })),
        )
        .execute();
    }
  });
  return getRestrictions(db, tournamentUserId);
}

/** The forecaster behind a paper account, or behind a tournament session. */
export type Trader = { readonly paperUserId: string } | { readonly tournamentUserId: string };

/**
 * Refuses a quote or trade on a name the trader attested a tie to, with
 * RESTRICTED_PERSON. Called inside the quote and trade services, so every
 * route that reaches them is covered.
 */
export async function assertMayTrade(
  db: TournamentDb,
  trader: Trader,
  companyId: string,
): Promise<void> {
  let tournamentUserId: string;
  if ("paperUserId" in trader) {
    const account = await db
      .selectFrom("users")
      .select("tournament_user_id")
      .where("id", "=", trader.paperUserId)
      .executeTakeFirst();
    if (account === undefined) return;
    tournamentUserId = account.tournament_user_id;
  } else {
    tournamentUserId = trader.tournamentUserId;
  }
  const restricted = await restrictedCompanies(db, tournamentUserId);
  const match = restricted.find((company) => company.id === companyId);
  if (match !== undefined) {
    throw new ServiceError(
      "RESTRICTED_PERSON",
      `You attested that you are employed by, a director of, or invested in ${match.name}, so its contracts are closed to you.`,
      { company: match.slug },
    );
  }
}
