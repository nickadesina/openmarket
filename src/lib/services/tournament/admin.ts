import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type {
  CloseQuestionInput,
  FlagUserInput,
  QuestionInput,
  ResolutionNoteInput,
  ResolveQuestionInput,
  VoidQuestionInput,
} from "../../api/tournament-schemas.js";
import { DISPUTE_WINDOW_MS } from "../../config/tournament.js";
import type { Database, TournamentQuestionStatus } from "../../db/schema.js";
import {
  assertValidBuckets,
  type Bucket,
  BucketError,
  binaryBuckets,
  bucketIndexForValue,
  floorIndex,
  numericBuckets,
} from "../../engine/tournament/buckets.js";
import { recomputeAggregate } from "./aggregate.js";
import { userIdForHandle } from "./identities.js";
import {
  databaseNow,
  effectiveStatus,
  loadBuckets,
  type QuestionRecord,
  requireQuestion,
  type TournamentDb,
  windowEnd,
} from "./records.js";
import { writeScores } from "./scoring.js";

function bucketsFor(input: QuestionInput): Bucket[] {
  try {
    const buckets =
      input.unit === "bool"
        ? binaryBuckets()
        : numericBuckets({
            edges: input.buckets.edges,
            floorLabel: input.buckets.floor_label,
            ...(input.buckets.labels === undefined ? {} : { labels: input.buckets.labels }),
          });
    assertValidBuckets(buckets, input.unit === "bool");
    return buckets;
  } catch (error) {
    if (error instanceof BucketError) throw new ServiceError("INVALID_INPUT", error.message);
    throw error;
  }
}

export interface SavedQuestion {
  readonly slug: string;
  readonly status: TournamentQuestionStatus;
  readonly bucketCount: number;
}

/**
 * Creates a draft, or replaces an existing draft in full. Once a question
 * opens its record is pinned: nothing about it changes except its lifecycle.
 */
export async function saveDraftQuestion(
  db: Kysely<Database>,
  input: QuestionInput,
): Promise<SavedQuestion> {
  const buckets = bucketsFor(input);
  const opensAt = new Date(input.opens_at);
  const closesAt = new Date(input.closes_at);
  const expiryAt = input.unit === "bool" ? closesAt : new Date(input.expiry_at);
  if (!(opensAt < closesAt && closesAt <= expiryAt)) {
    throw new ServiceError("INVALID_INPUT", "Times must satisfy opens_at < closes_at ≤ expiry_at.");
  }

  return db.transaction().execute(async (transaction) => {
    const existing = await transaction
      .selectFrom("tournament_questions")
      .select(["id", "status"])
      .where("slug", "=", input.slug)
      .forUpdate()
      .executeTakeFirst();
    if (existing !== undefined && existing.status !== "draft") {
      throw new ServiceError(
        "QUESTION_STATE",
        "Only a draft can be edited; this question is pinned.",
      );
    }

    const values = {
      slug: input.slug,
      title: input.title,
      description_md: input.description_md,
      rulebook_md: input.rulebook_md,
      rulebook_version: input.rulebook_version,
      unit: input.unit,
      bucket_count: buckets.length,
      opens_at: opensAt,
      closes_at: closesAt,
      expiry_at: expiryAt,
      status: "draft" as const,
      min_account_age_days: input.min_account_age_days ?? 90,
      extremization: input.extremization ?? 1.5,
      x_thread_url: input.x_thread_url ?? null,
    };
    let questionId: string;
    if (existing === undefined) {
      const inserted = await transaction
        .insertInto("tournament_questions")
        .values(values)
        .returning("id")
        .executeTakeFirstOrThrow();
      questionId = inserted.id;
    } else {
      questionId = existing.id;
      await transaction
        .deleteFrom("tournament_buckets")
        .where("question_id", "=", questionId)
        .execute();
      await transaction
        .updateTable("tournament_questions")
        .set(values)
        .where("id", "=", questionId)
        .execute();
    }
    await transaction
      .insertInto("tournament_buckets")
      .values(
        buckets.map((bucket) => ({
          question_id: questionId,
          index: bucket.index,
          kind: bucket.kind,
          lower: bucket.lower === null ? null : String(bucket.lower),
          upper: bucket.upper === null ? null : String(bucket.upper),
          label: bucket.label,
        })),
      )
      .execute();
    return { slug: input.slug, status: "draft", bucketCount: buckets.length };
  });
}

function stateError(message: string): ServiceError {
  return new ServiceError("QUESTION_STATE", message);
}

export async function openQuestion(db: Kysely<Database>, slug: string): Promise<SavedQuestion> {
  return db.transaction().execute(async (transaction) => {
    const question = await requireQuestion(transaction, slug, {
      includeDrafts: true,
      forUpdate: true,
    });
    if (question.storedStatus !== "draft") throw stateError("Only a draft can be opened.");
    const now = await databaseNow(transaction);
    if (now.getTime() >= question.closesAt.getTime()) {
      throw stateError("This draft's close time has already passed.");
    }
    await transaction
      .updateTable("tournament_questions")
      .set({ status: "open" })
      .where("id", "=", question.id)
      .execute();
    return { slug, status: "open", bucketCount: question.bucketCount };
  });
}

/**
 * Manual early close at the resolution document's public timestamp.
 * Forecasts after it stay in the log and are never counted.
 */
export async function closeQuestion(
  db: Kysely<Database>,
  slug: string,
  input: CloseQuestionInput,
): Promise<{ readonly slug: string; readonly closedAt: string }> {
  return db.transaction().execute(async (transaction) => {
    const question = await requireQuestion(transaction, slug, { forUpdate: true });
    const now = await databaseNow(transaction);
    if (effectiveStatus(question, now) !== "open")
      throw stateError("Only an open question can be closed.");
    const closedAt = input.closed_at === undefined ? now : new Date(input.closed_at);
    if (closedAt.getTime() > now.getTime())
      throw stateError("A close cannot be scheduled in the future.");
    if (closedAt.getTime() < question.opensAt.getTime()) {
      throw stateError("A close cannot precede the question's opening.");
    }
    await transaction
      .updateTable("tournament_questions")
      .set({ status: "closed", closed_at: closedAt })
      .where("id", "=", question.id)
      .execute();
    const closed: QuestionRecord = { ...question, storedStatus: "closed", closedAt };
    await recomputeAggregate(
      transaction,
      closed,
      await loadBuckets(transaction, question.id),
      now,
      closedAt,
    );
    return { slug, closedAt: closedAt.toISOString() };
  });
}

function expectedWinningBucket(
  question: QuestionRecord,
  buckets: readonly Bucket[],
  input: ResolveQuestionInput,
  now: Date,
): number {
  if (question.unit === "bool") {
    if (input.resolved_value !== null) {
      throw new ServiceError("INVALID_INPUT", "A binary resolves by bucket, with no value.");
    }
    if (input.winning_bucket_index > 1) {
      throw new ServiceError("INVALID_INPUT", "A binary resolves to Yes (0) or No (1).");
    }
    return input.winning_bucket_index;
  }
  if (input.resolved_value === null) {
    if (now.getTime() < question.expiryAt.getTime()) {
      throw stateError("The floor resolves only once expiry_at has passed with no document.");
    }
    if (input.rung_fired !== null) {
      throw new ServiceError("INVALID_INPUT", "A floor resolution has no rung.");
    }
    return floorIndex(buckets)!;
  }
  try {
    return bucketIndexForValue(buckets, input.resolved_value);
  } catch (error) {
    if (error instanceof BucketError) throw new ServiceError("INVALID_INPUT", error.message);
    throw error;
  }
}

export interface ResolutionOutcome {
  readonly slug: string;
  readonly resolutionId: string;
  readonly winningBucketIndex: number;
  readonly scoresWritten: number;
  readonly supersededResolutionId: string | null;
  readonly resolvedAt: string;
}

/**
 * Writes the question's live resolution and scores every forecaster
 * synchronously. A second call inside the dispute window supersedes the
 * live row and rescoring writes a fresh set of immutable score rows.
 */
export async function resolveQuestion(
  db: Kysely<Database>,
  slug: string,
  input: ResolveQuestionInput,
  resolverUserId: string,
): Promise<ResolutionOutcome> {
  return db.transaction().execute(async (transaction) => {
    const question = await requireQuestion(transaction, slug, { forUpdate: true });
    const now = await databaseNow(transaction);
    const status = effectiveStatus(question, now);
    if (status === "open") throw stateError("Close the question before resolving it.");
    if (status === "voided") throw stateError("A voided question cannot be resolved.");

    let live: { id: string } | undefined;
    if (status === "resolved") {
      const first = await transaction
        .selectFrom("tournament_resolutions")
        .select("resolved_at")
        .where("question_id", "=", question.id)
        .orderBy("resolved_at", "asc")
        .limit(1)
        .executeTakeFirstOrThrow();
      if (now.getTime() - first.resolved_at.getTime() > DISPUTE_WINDOW_MS) {
        throw stateError("The 72-hour dispute window has closed; the resolution is final.");
      }
      live = await transaction
        .selectFrom("tournament_resolutions")
        .select("id")
        .where("question_id", "=", question.id)
        .where("superseded_by", "is", null)
        .executeTakeFirstOrThrow();
    }

    const buckets = await loadBuckets(transaction, question.id);
    const computed = expectedWinningBucket(question, buckets, input, now);
    if (computed !== input.winning_bucket_index) {
      throw new ServiceError(
        "INVALID_INPUT",
        `The resolved value falls in bucket ${computed} (${buckets[computed]!.label}); confirm that bucket.`,
        { computedWinningBucketIndex: computed },
      );
    }

    const resolutionId = randomUUID();
    if (live !== undefined) {
      // The deferred foreign key lets the old row name its successor before it exists.
      await transaction
        .updateTable("tournament_resolutions")
        .set({ superseded_by: resolutionId })
        .where("id", "=", live.id)
        .execute();
    }
    await insertResolution(
      transaction,
      question,
      input,
      resolverUserId,
      now,
      computed,
      resolutionId,
    );

    await transaction
      .updateTable("tournament_questions")
      .set({ status: "resolved" })
      .where("id", "=", question.id)
      .execute();
    const scoresWritten = await writeScores(transaction, question, resolutionId, computed, now);
    return {
      slug,
      resolutionId,
      winningBucketIndex: computed,
      scoresWritten,
      supersededResolutionId: live?.id ?? null,
      resolvedAt: now.toISOString(),
    };
  });
}

async function insertResolution(
  db: TournamentDb,
  question: QuestionRecord,
  input: ResolveQuestionInput,
  resolverUserId: string,
  now: Date,
  winningIndex: number,
  id: string,
): Promise<void> {
  await db
    .insertInto("tournament_resolutions")
    .values({
      id,
      question_id: question.id,
      resolved_at: now,
      winning_bucket_index: winningIndex,
      resolved_value: input.resolved_value === null ? null : String(input.resolved_value),
      rung_fired: input.rung_fired,
      source_url: input.source_url,
      source_excerpt: input.source_excerpt,
      note_md: input.note_md,
      resolver_user_id: resolverUserId,
    })
    .execute();
}

export async function voidQuestion(
  db: Kysely<Database>,
  slug: string,
  input: VoidQuestionInput,
): Promise<{ readonly slug: string; readonly status: "voided" }> {
  return db.transaction().execute(async (transaction) => {
    const question = await requireQuestion(transaction, slug, {
      includeDrafts: true,
      forUpdate: true,
    });
    if (question.storedStatus === "resolved" || question.storedStatus === "voided") {
      throw stateError("Only an unresolved question can be voided.");
    }
    await transaction
      .updateTable("tournament_questions")
      .set({ status: "voided", void_note_md: input.note_md })
      .where("id", "=", question.id)
      .execute();
    return { slug, status: "voided" };
  });
}

export async function addResolutionNote(
  db: Kysely<Database>,
  slug: string,
  input: ResolutionNoteInput,
): Promise<{ readonly id: string; readonly createdAt: string }> {
  const question = await requireQuestion(db, slug);
  if (question.storedStatus !== "resolved") {
    throw stateError("Resolution notes record disputes on a resolved question.");
  }
  const row = await db
    .insertInto("tournament_resolution_notes")
    .values({ question_id: question.id, note_md: input.note_md })
    .returning(["id", "created_at"])
    .executeTakeFirstOrThrow();
  return { id: row.id, createdAt: row.created_at.toISOString() };
}

/**
 * Flags or clears an account. Flagged accounts stay scored and shown but
 * leave the aggregate, so every open question they forecast is recomputed.
 */
export async function setUserFlag(
  db: Kysely<Database>,
  input: FlagUserInput,
): Promise<{ readonly handle: string; readonly flagged: boolean; readonly recomputed: number }> {
  return db.transaction().execute(async (transaction) => {
    const userId = await userIdForHandle(transaction, input.handle);
    if (userId === undefined) {
      throw new ServiceError("FORECASTER_NOT_FOUND", "No forecaster has that handle.");
    }
    const identity = { user_id: userId, handle: input.handle };
    await transaction
      .updateTable("tournament_users")
      .set({ flagged: input.flagged, flag_reason: input.flagged ? input.reason! : null })
      .where("id", "=", identity.user_id)
      .execute();

    const questions = await transaction
      .selectFrom("tournament_questions")
      .selectAll()
      .where("status", "=", "open")
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom("tournament_forecast_events")
            .select("id")
            .whereRef("tournament_forecast_events.question_id", "=", "tournament_questions.id")
            .where("tournament_forecast_events.user_id", "=", identity.user_id),
        ),
      )
      .orderBy("id")
      .forUpdate()
      .execute();
    const now = await databaseNow(transaction);
    let recomputed = 0;
    for (const row of questions) {
      const question = await requireQuestion(transaction, row.slug);
      if (effectiveStatus(question, now) !== "open") continue;
      await recomputeAggregate(
        transaction,
        question,
        await loadBuckets(transaction, question.id),
        now,
        windowEnd(question),
      );
      recomputed += 1;
    }
    return { handle: identity.handle, flagged: input.flagged, recomputed };
  });
}

export interface AdminQuestion {
  readonly slug: string;
  readonly title: string;
  readonly unit: QuestionRecord["unit"];
  readonly storedStatus: TournamentQuestionStatus;
  readonly status: TournamentQuestionStatus;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly windowEndsAt: string;
  readonly expiryAt: string;
  readonly buckets: readonly Bucket[];
  readonly forecastEvents: number;
  readonly forecasters: number;
  readonly disputeWindowEndsAt: string | null;
}

/** Every question including drafts, for the admin console. */
export async function listAdminQuestions(db: Kysely<Database>): Promise<AdminQuestion[]> {
  const rows = await db
    .selectFrom("tournament_questions")
    .selectAll()
    .orderBy("created_at", "desc")
    .execute();
  const now = await databaseNow(db);
  const questions: AdminQuestion[] = [];
  for (const row of rows) {
    const question = await requireQuestion(db, row.slug, { includeDrafts: true });
    const counts = await db
      .selectFrom("tournament_forecast_events")
      .select((eb) => [
        eb.fn.countAll<string>().as("events"),
        eb.fn.count<string>("user_id").distinct().as("forecasters"),
      ])
      .where("question_id", "=", question.id)
      .executeTakeFirstOrThrow();
    const first = await db
      .selectFrom("tournament_resolutions")
      .select("resolved_at")
      .where("question_id", "=", question.id)
      .orderBy("resolved_at", "asc")
      .limit(1)
      .executeTakeFirst();
    questions.push({
      slug: question.slug,
      title: question.title,
      unit: question.unit,
      storedStatus: question.storedStatus,
      status: effectiveStatus(question, now),
      opensAt: question.opensAt.toISOString(),
      closesAt: question.closesAt.toISOString(),
      windowEndsAt: windowEnd(question).toISOString(),
      expiryAt: question.expiryAt.toISOString(),
      buckets: await loadBuckets(db, question.id),
      forecastEvents: Number(counts.events),
      forecasters: Number(counts.forecasters),
      disputeWindowEndsAt:
        first === undefined
          ? null
          : new Date(first.resolved_at.getTime() + DISPUTE_WINDOW_MS).toISOString(),
    });
  }
  return questions;
}
