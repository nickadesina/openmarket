import { createHash } from "node:crypto";

import type { Kysely } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type { EvidenceInput, EvidenceReviewInput } from "../../api/tournament-schemas.js";
import type {
  Database,
  EventFlagKind,
  EventFlagReviewDecision,
  EvidenceKind,
  JsonObject,
} from "../../db/schema.js";
import { identitiesFor } from "./identities.js";
import { databaseNow, requireQuestion, type TournamentDb } from "./records.js";

/**
 * Evidence from forecasters (milestone 7, TECHNICAL_DESIGN.md §7). A signed-in
 * forecaster posts a source on a question linked to a listed instrument; it
 * becomes an `event_flags` row of kind `user_submitted` for the instrument's
 * company at low confidence, with its submitter and the kind it claims to be
 * in their own columns. Nothing in the dealer reads `user_submitted` rows:
 * they widen nothing, price nothing and settle nothing, and the public
 * flags feed leaves them out.
 *
 * An admin reviews each submission once, append-only: confirmed, citing the
 * later independent flag that confirms it, or rejected. The fixed bonus
 * score a confirmation is to earn needs a scoring decision not yet made
 * (README D9); no score row is written here.
 *
 * dedupe_key follows TECHNICAL_DESIGN.md §4 with the claimed kind:
 * sha256(company | kind | outlet | published day | valuation to one
 * significant figure), first 16 hex, so syndications and re-submissions of
 * one report share a key.
 */

export interface SubmittedEvidence {
  readonly id: string;
  readonly question_slug: string;
  readonly company: string;
  readonly kind: "user_submitted";
  readonly submitted_kind: EvidenceKind;
  readonly source_url: string;
  readonly published_at: Date | null;
  readonly observed_at: Date;
  readonly confidence: "low";
  readonly dedupe_key: string;
  readonly review: "pending" | EventFlagReviewDecision;
}

function oneSignificantFigure(value: number | undefined): string {
  return value === undefined ? "" : String(Number(value.toPrecision(1)));
}

function normalizedOutlet(outlet: string | undefined): string {
  return outlet === undefined ? "" : outlet.trim().toLowerCase().replace(/\s+/g, " ");
}

export function evidenceDedupeKey(input: {
  readonly companySlug: string;
  readonly kind: EvidenceKind;
  readonly outlet?: string | undefined;
  readonly day: string;
  readonly valuationUsd?: number | undefined;
}): string {
  const parts = [
    input.companySlug,
    input.kind,
    normalizedOutlet(input.outlet),
    input.day,
    oneSignificantFigure(input.valuationUsd),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

/** The terms in decision 0001's fixed shape; absent fields stay absent. */
export function evidenceTerms(input: EvidenceInput): JsonObject {
  const terms = input.terms;
  if (terms === undefined) return { valuation_basis: "unknown" };
  return {
    valuation_basis: terms.valuation_basis,
    ...(terms.valuation_usd === undefined ? {} : { valuation_usd: terms.valuation_usd }),
    ...(terms.amount_usd === undefined ? {} : { amount_usd: terms.amount_usd }),
    ...(terms.outlet === undefined ? {} : { outlet: terms.outlet }),
  };
}

/** The listed company behind a linked question, or QUESTION_STATE when it has no instrument. */
async function linkedCompany(db: TournamentDb, slug: string) {
  const question = await requireQuestion(db, slug);
  const company = await db
    .selectFrom("tournament_instrument_links as links")
    .innerJoin("instruments", "instruments.id", "links.instrument_id")
    .innerJoin("listings", "listings.id", "instruments.listing_id")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .select(["companies.id", "companies.slug", "companies.name"])
    .where("links.question_id", "=", question.id)
    .executeTakeFirst();
  if (company === undefined) {
    throw new ServiceError(
      "QUESTION_STATE",
      "Evidence is collected on questions linked to a listed name's contract.",
    );
  }
  return { question, company };
}

export async function submitEvidence(
  db: Kysely<Database>,
  input: { readonly slug: string; readonly userId: string; readonly evidence: EvidenceInput },
): Promise<{ readonly evidence: SubmittedEvidence; readonly replayed: boolean }> {
  const { evidence } = input;
  return db.transaction().execute(async (transaction) => {
    const { question, company } = await linkedCompany(transaction, input.slug);
    const now = await databaseNow(transaction);
    const publishedAt =
      evidence.published_at === undefined ? null : new Date(evidence.published_at);
    if (publishedAt !== null && publishedAt.getTime() > now.getTime()) {
      throw new ServiceError("INVALID_INPUT", "published_at cannot be in the future.");
    }
    const dedupeKey = evidenceDedupeKey({
      companySlug: company.slug,
      kind: evidence.kind,
      outlet: evidence.terms?.outlet,
      day: (publishedAt ?? now).toISOString().slice(0, 10),
      valuationUsd: evidence.terms?.valuation_usd,
    });
    const view = (row: {
      id: string;
      observed_at: Date;
      published_at: Date | null;
      review: EventFlagReviewDecision | null;
    }): SubmittedEvidence => ({
      id: row.id,
      question_slug: question.slug,
      company: company.name,
      kind: "user_submitted",
      submitted_kind: evidence.kind,
      source_url: evidence.source_url,
      published_at: row.published_at,
      observed_at: row.observed_at,
      confidence: "low",
      dedupe_key: dedupeKey,
      review: row.review ?? "pending",
    });

    // The same source re-sent by the same forecaster is the row already filed.
    const existing = await transaction
      .selectFrom("event_flags")
      .leftJoin("event_flag_reviews as reviews", "reviews.flag_id", "event_flags.id")
      .select([
        "event_flags.id",
        "event_flags.observed_at",
        "event_flags.published_at",
        "reviews.decision as review",
      ])
      .where("event_flags.submitted_by", "=", input.userId)
      .where("event_flags.company_id", "=", company.id)
      .where("event_flags.dedupe_key", "=", dedupeKey)
      .where("event_flags.source_url", "=", evidence.source_url)
      .executeTakeFirst();
    if (existing !== undefined) return { evidence: view(existing), replayed: true };

    const inserted = await transaction
      .insertInto("event_flags")
      .values({
        company_id: company.id,
        kind: "user_submitted",
        source_url: evidence.source_url,
        source_rank: null,
        observed_at: now,
        published_at: publishedAt,
        terms_json: evidenceTerms(evidence),
        confidence: "low",
        dedupe_key: dedupeKey,
        promoted_from: null,
        run_id: null,
        submitted_by: input.userId,
        submitted_kind: evidence.kind,
      })
      .returning(["id", "observed_at", "published_at"])
      .executeTakeFirstOrThrow();
    return { evidence: view({ ...inserted, review: null }), replayed: false };
  });
}

/** Flags an admin may cite as the later independent confirmation of a submission. */
const CONFIRMING_KINDS: readonly EventFlagKind[] = [
  "form_d",
  "form_d_amend",
  "charter",
  "scoop",
  "release",
  "s1_public",
  "print",
];

export interface EvidenceReview {
  readonly id: string;
  readonly flag_id: string;
  readonly decision: EventFlagReviewDecision;
  readonly confirming_flag_id: string | null;
  readonly created_at: Date;
}

/** An admin's one review of a submission: confirmed by a later independent flag, or rejected. */
export async function reviewEvidence(
  db: Kysely<Database>,
  input: {
    readonly flagId: string;
    readonly reviewerUserId: string;
    readonly review: EvidenceReviewInput;
  },
): Promise<EvidenceReview> {
  const { review } = input;
  return db.transaction().execute(async (transaction) => {
    const flag = await transaction
      .selectFrom("event_flags")
      .select(["id", "company_id", "observed_at"])
      .where("id", "=", input.flagId)
      .where("kind", "=", "user_submitted")
      .forUpdate()
      .executeTakeFirst();
    if (flag === undefined) {
      throw new ServiceError("EVIDENCE_NOT_FOUND", "No submitted evidence has that id.");
    }
    const previous = await transaction
      .selectFrom("event_flag_reviews")
      .select("decision")
      .where("flag_id", "=", flag.id)
      .executeTakeFirst();
    if (previous !== undefined) {
      throw new ServiceError(
        "EVIDENCE_REVIEWED",
        `This evidence was already ${previous.decision}.`,
      );
    }
    if (review.decision === "confirmed") {
      const confirming = await transaction
        .selectFrom("event_flags")
        .select(["company_id", "kind", "observed_at"])
        .where("id", "=", review.confirming_flag_id!)
        .executeTakeFirst();
      if (
        confirming === undefined ||
        confirming.company_id !== flag.company_id ||
        !CONFIRMING_KINDS.includes(confirming.kind) ||
        confirming.observed_at.getTime() < flag.observed_at.getTime()
      ) {
        throw new ServiceError(
          "INVALID_INPUT",
          "A confirmation cites a later, independent flag for the same name.",
        );
      }
    }
    return transaction
      .insertInto("event_flag_reviews")
      .values({
        flag_id: flag.id,
        decision: review.decision,
        confirming_flag_id: review.confirming_flag_id ?? null,
        reviewer_user_id: input.reviewerUserId,
        note: review.note ?? null,
      })
      .returning(["id", "flag_id", "decision", "confirming_flag_id", "created_at"])
      .executeTakeFirstOrThrow();
  });
}

export interface PendingEvidence {
  readonly flag_id: string;
  readonly company: string;
  readonly submitted_kind: EvidenceKind;
  readonly source_url: string | null;
  readonly published_at: Date | null;
  readonly observed_at: Date;
  readonly terms: JsonObject;
  readonly dedupe_key: string;
  /** The submitter's public handle (profile slug), or null if the identity is gone. */
  readonly submitter: string | null;
  /** Later flags for the same name an admin may confirm it with, same report first. */
  readonly candidates: readonly {
    readonly flag_id: string;
    readonly kind: EventFlagKind;
    readonly source_url: string | null;
    readonly observed_at: Date;
    readonly same_report: boolean;
  }[];
}

const PENDING_LIMIT = 100;
const CANDIDATES_PER_SUBMISSION = 5;

/** Unreviewed submissions, oldest first, for /admin/dealer's queue. */
export async function listPendingEvidence(db: Kysely<Database>): Promise<PendingEvidence[]> {
  const rows = await db
    .selectFrom("event_flags")
    .innerJoin("companies", "companies.id", "event_flags.company_id")
    .leftJoin("event_flag_reviews as reviews", "reviews.flag_id", "event_flags.id")
    .select([
      "event_flags.id",
      "event_flags.company_id",
      "companies.name as company",
      "event_flags.submitted_kind",
      "event_flags.submitted_by",
      "event_flags.source_url",
      "event_flags.published_at",
      "event_flags.observed_at",
      "event_flags.terms_json",
      "event_flags.dedupe_key",
    ])
    .where("event_flags.kind", "=", "user_submitted")
    .where("reviews.id", "is", null)
    .orderBy("event_flags.observed_at")
    .orderBy("event_flags.id")
    .limit(PENDING_LIMIT)
    .execute();
  const identities = await identitiesFor(
    db,
    rows.map((row) => row.submitted_by!),
  );
  const pending: PendingEvidence[] = [];
  for (const row of rows) {
    const candidates = await db
      .selectFrom("event_flags")
      .select(["id", "kind", "source_url", "observed_at", "dedupe_key"])
      .where("company_id", "=", row.company_id)
      .where("kind", "in", CONFIRMING_KINDS)
      .where("observed_at", ">=", row.observed_at)
      .orderBy((eb) => eb.case().when("dedupe_key", "=", row.dedupe_key).then(0).else(1).end())
      .orderBy("observed_at")
      .orderBy("id")
      .limit(CANDIDATES_PER_SUBMISSION)
      .execute();
    pending.push({
      flag_id: row.id,
      company: row.company,
      submitted_kind: row.submitted_kind!,
      source_url: row.source_url,
      published_at: row.published_at,
      observed_at: row.observed_at,
      terms: row.terms_json,
      dedupe_key: row.dedupe_key,
      submitter: identities.get(row.submitted_by!)?.profileSlug ?? null,
      candidates: candidates.map((candidate) => ({
        flag_id: candidate.id,
        kind: candidate.kind,
        source_url: candidate.source_url,
        observed_at: candidate.observed_at,
        same_report: candidate.dedupe_key === row.dedupe_key,
      })),
    });
  }
  return pending;
}
