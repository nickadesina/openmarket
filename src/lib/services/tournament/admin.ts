import { randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

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
import type {
  Database,
  TournamentQuestionKind,
  TournamentQuestionStatus,
  TournamentUnit,
} from "../../db/schema.js";
import { recomputeAggregate } from "./aggregate.js";
import { userIdForHandle } from "./identities.js";
import {
  databaseNow,
  effectiveStatus,
  type QuestionRecord,
  requireQuestion,
  type TournamentDb,
  windowEnd,
} from "./records.js";
import { type ResolvedAs, writeScores } from "./scoring.js";

export interface SavedQuestion {
  readonly slug: string;
  readonly status: TournamentQuestionStatus;
  readonly kind: TournamentQuestionKind;
}

/**
 * Creates a draft, or replaces an existing draft in full. Once a question
 * opens its record is pinned: nothing about it changes except its lifecycle.
 */
export async function saveDraftQuestion(
  db: Kysely<Database>,
  input: QuestionInput,
): Promise<SavedQuestion> {
  const draft = validatedDraft(input);
  return db.transaction().execute((transaction) => writeDraft(transaction, input, draft));
}

/**
 * saveDraftQuestion inside the caller's transaction: the tournament bridge
 * creates a linked question in the transaction that lists its instrument.
 */
export async function saveDraftQuestionIn(
  transaction: Transaction<Database>,
  input: QuestionInput,
): Promise<SavedQuestion> {
  return writeDraft(transaction, input, validatedDraft(input));
}

interface ValidatedDraft {
  readonly opensAt: Date;
  readonly closesAt: Date;
  readonly expiryAt: Date;
}

/** A binary's expiry is its close; a forward names its own, at or after the close. */
function validatedDraft(input: QuestionInput): ValidatedDraft {
  const opensAt = new Date(input.opens_at);
  const closesAt = new Date(input.closes_at);
  const expiryAt = input.kind === "binary" ? closesAt : new Date(input.expiry_at);
  if (!(opensAt < closesAt && closesAt <= expiryAt)) {
    throw new ServiceError("INVALID_INPUT", "Times must satisfy opens_at < closes_at ≤ expiry_at.");
  }
  return { opensAt, closesAt, expiryAt };
}

async function writeDraft(
  transaction: Transaction<Database>,
  input: QuestionInput,
  { opensAt, closesAt, expiryAt }: ValidatedDraft,
): Promise<SavedQuestion> {
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
    kind: input.kind,
    unit: input.kind === "forward" ? input.unit : null,
    opens_at: opensAt,
    closes_at: closesAt,
    expiry_at: expiryAt,
    status: "draft" as const,
    min_account_age_days: input.min_account_age_days ?? 90,
    extremization: input.extremization ?? 1.5,
    x_thread_url: input.x_thread_url ?? null,
  };
  if (existing === undefined) {
    await transaction.insertInto("tournament_questions").values(values).execute();
  } else {
    await transaction
      .updateTable("tournament_questions")
      .set(values)
      .where("id", "=", existing.id)
      .execute();
  }
  return { slug: input.slug, status: "draft", kind: input.kind };
}

function stateError(message: string): ServiceError {
  return new ServiceError("QUESTION_STATE", message);
}

export async function openQuestion(db: Kysely<Database>, slug: string): Promise<SavedQuestion> {
  return db.transaction().execute((transaction) => openQuestionIn(transaction, slug));
}

/**
 * openQuestion inside the caller's transaction. `at` is the caller's clock
 * (the dealer job's); the database clock, read after the lock, when omitted.
 */
export async function openQuestionIn(
  transaction: Transaction<Database>,
  slug: string,
  at?: Date,
): Promise<SavedQuestion> {
  const question = await requireQuestion(transaction, slug, {
    includeDrafts: true,
    forUpdate: true,
  });
  if (question.storedStatus !== "draft") throw stateError("Only a draft can be opened.");
  const now = at ?? (await databaseNow(transaction));
  if (now.getTime() >= question.closesAt.getTime()) {
    throw stateError("This draft's close time has already passed.");
  }
  await transaction
    .updateTable("tournament_questions")
    .set({ status: "open" })
    .where("id", "=", question.id)
    .execute();
  return { slug, status: "open", kind: question.kind };
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
  return db.transaction().execute((transaction) => closeQuestionIn(transaction, slug, input));
}

export interface CloseOptions {
  /** The caller's clock (the settle job's); the database clock when omitted. */
  readonly at?: Date;
  /**
   * Also back-date a question whose scheduled close has passed but which
   * nobody has closed or resolved: a resolution document public before the
   * close but observed after it (the settle job's one-day grace) still ends
   * the scoring window at its own time. The close stays ≤ closes_at.
   */
  readonly afterScheduledClose?: boolean;
}

/** closeQuestion inside the caller's transaction. */
export async function closeQuestionIn(
  transaction: Transaction<Database>,
  slug: string,
  input: CloseQuestionInput,
  options: CloseOptions = {},
): Promise<{ readonly slug: string; readonly closedAt: string }> {
  const question = await requireQuestion(transaction, slug, { forUpdate: true });
  const now = options.at ?? (await databaseNow(transaction));
  const pastScheduledClose =
    options.afterScheduledClose === true &&
    question.storedStatus === "open" &&
    question.closedAt === null;
  if (effectiveStatus(question, now) !== "open" && !pastScheduledClose)
    throw stateError("Only an open question can be closed.");
  const closedAt = input.closed_at === undefined ? now : new Date(input.closed_at);
  if (closedAt.getTime() > now.getTime())
    throw stateError("A close cannot be scheduled in the future.");
  if (closedAt.getTime() < question.opensAt.getTime()) {
    throw stateError("A close cannot precede the question's opening.");
  }
  if (closedAt.getTime() > question.closesAt.getTime()) {
    throw stateError("A close cannot fall after the question's scheduled close.");
  }
  await transaction
    .updateTable("tournament_questions")
    .set({ status: "closed", closed_at: closedAt })
    .where("id", "=", question.id)
    .execute();
  const closed: QuestionRecord = { ...question, storedStatus: "closed", closedAt };
  await recomputeAggregate(transaction, closed, now, closedAt);
  return { slug, closedAt: closedAt.toISOString() };
}

/** The resolution the input states, checked against the question's kind. */
function resolvedFrom(question: QuestionRecord, input: ResolveQuestionInput): ResolvedAs {
  if (question.kind === "binary") {
    if (!("outcome" in input)) {
      throw new ServiceError("INVALID_INPUT", "A binary resolves YES or NO, by its outcome.");
    }
    return { outcome: input.outcome };
  }
  if (!("resolved_value" in input)) {
    throw new ServiceError(
      "INVALID_INPUT",
      "A forward resolves to its settling value; a forward with no figure is voided.",
    );
  }
  if (!(input.resolved_value > 0) || !Number.isFinite(input.resolved_value)) {
    throw new ServiceError("INVALID_INPUT", "A forward's settling value must be greater than 0.");
  }
  return { value: input.resolved_value };
}

/** The first resolution's time; the dispute window runs from it. */
async function firstResolvedAt(db: TournamentDb, questionId: string): Promise<Date> {
  const first = await db
    .selectFrom("tournament_resolutions")
    .select("resolved_at")
    .where("question_id", "=", questionId)
    .orderBy("resolved_at", "asc")
    .limit(1)
    .executeTakeFirstOrThrow();
  return first.resolved_at;
}

async function liveResolutionId(db: TournamentDb, questionId: string): Promise<string> {
  const live = await db
    .selectFrom("tournament_resolutions")
    .select("id")
    .where("question_id", "=", questionId)
    .where("superseded_by", "is", null)
    .executeTakeFirstOrThrow();
  return live.id;
}

export interface ResolutionOutcome {
  readonly slug: string;
  readonly resolutionId: string;
  /** A binary's outcome; null for a forward. */
  readonly outcome: "yes" | "no" | null;
  /** A forward's settling value in its unit; null for a binary. */
  readonly resolvedValue: number | null;
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
  return db
    .transaction()
    .execute((transaction) =>
      resolveQuestionIn(transaction, slug, input, { userId: resolverUserId }),
    );
}

/** Who resolved: an admin, or the settle run that resolved a linked question. */
export type Resolver = { readonly userId: string } | { readonly settleRunId: string };

/** resolveQuestion inside the caller's transaction; `at` as for closeQuestionIn. */
export async function resolveQuestionIn(
  transaction: Transaction<Database>,
  slug: string,
  input: ResolveQuestionInput,
  resolver: Resolver,
  at?: Date,
): Promise<ResolutionOutcome> {
  const question = await requireQuestion(transaction, slug, { forUpdate: true });
  const now = at ?? (await databaseNow(transaction));
  const status = effectiveStatus(question, now);
  if (status === "open") throw stateError("Close the question before resolving it.");
  if (status === "voided") throw stateError("A voided question cannot be resolved.");

  const resolved = resolvedFrom(question, input);
  let live: string | undefined;
  if (status === "resolved") {
    const first = await firstResolvedAt(transaction, question.id);
    if (now.getTime() - first.getTime() > DISPUTE_WINDOW_MS) {
      throw stateError("The 72-hour dispute window has closed; the resolution is final.");
    }
    live = await liveResolutionId(transaction, question.id);
  }

  const resolutionId = randomUUID();
  if (live !== undefined) {
    // The deferred foreign key lets the old row name its successor before it exists.
    await transaction
      .updateTable("tournament_resolutions")
      .set({ superseded_by: resolutionId })
      .where("id", "=", live)
      .execute();
  }
  await insertResolution(transaction, question, input, resolved, resolver, now, resolutionId);

  await transaction
    .updateTable("tournament_questions")
    .set({ status: "resolved" })
    .where("id", "=", question.id)
    .execute();
  const scoresWritten = await writeScores(transaction, question, resolutionId, resolved, now);
  return {
    slug,
    resolutionId,
    outcome: "outcome" in resolved ? resolved.outcome : null,
    resolvedValue: "value" in resolved ? resolved.value : null,
    scoresWritten,
    supersededResolutionId: live ?? null,
    resolvedAt: now.toISOString(),
  };
}

async function insertResolution(
  db: TournamentDb,
  question: QuestionRecord,
  input: ResolveQuestionInput,
  resolved: ResolvedAs,
  resolver: Resolver,
  now: Date,
  id: string,
): Promise<void> {
  await db
    .insertInto("tournament_resolutions")
    .values({
      id,
      question_id: question.id,
      resolved_at: now,
      outcome: "outcome" in resolved ? resolved.outcome : null,
      resolved_value: "value" in resolved ? String(resolved.value) : null,
      rung_fired: input.rung_fired,
      source_url: input.source_url,
      source_excerpt: input.source_excerpt,
      note_md: input.note_md,
      resolver_user_id: "userId" in resolver ? resolver.userId : null,
      settle_run_id: "settleRunId" in resolver ? resolver.settleRunId : null,
    })
    .execute();
}

export async function voidQuestion(
  db: Kysely<Database>,
  slug: string,
  input: VoidQuestionInput,
): Promise<{ readonly slug: string; readonly status: "voided" }> {
  return db.transaction().execute((transaction) => voidQuestionIn(transaction, slug, input));
}

/**
 * voidQuestion inside the caller's transaction. A voided question writes no
 * scores. A resolved question is voidable inside its 72-hour dispute window
 * (a forward resolved on a figure that turns out to be a void): the void
 * supersedes its live resolution, which the supersede-only resolutions table
 * records as the row naming itself (`superseded_by = id`). No resolution
 * stays live, so its scores leave the leaderboard, which counts only live
 * resolutions of resolved questions. `at` as for closeQuestionIn.
 */
export async function voidQuestionIn(
  transaction: Transaction<Database>,
  slug: string,
  input: VoidQuestionInput,
  at?: Date,
): Promise<{ readonly slug: string; readonly status: "voided" }> {
  const question = await requireQuestion(transaction, slug, {
    includeDrafts: true,
    forUpdate: true,
  });
  if (question.storedStatus === "voided") throw stateError("This question is already voided.");
  if (question.storedStatus === "resolved") {
    const now = at ?? (await databaseNow(transaction));
    const first = await firstResolvedAt(transaction, question.id);
    if (now.getTime() - first.getTime() > DISPUTE_WINDOW_MS) {
      throw stateError("The 72-hour dispute window has closed; the resolution is final.");
    }
    const live = await liveResolutionId(transaction, question.id);
    await transaction
      .updateTable("tournament_resolutions")
      .set({ superseded_by: live })
      .where("id", "=", live)
      .execute();
  }
  await transaction
    .updateTable("tournament_questions")
    .set({ status: "voided", void_note_md: input.note_md })
    .where("id", "=", question.id)
    .execute();
  return { slug, status: "voided" };
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
      await recomputeAggregate(transaction, question, now, windowEnd(question));
      recomputed += 1;
    }
    return { handle: identity.handle, flagged: input.flagged, recomputed };
  });
}

export interface AdminQuestion {
  readonly slug: string;
  readonly title: string;
  readonly kind: TournamentQuestionKind;
  readonly unit: TournamentUnit | null;
  readonly storedStatus: TournamentQuestionStatus;
  readonly status: TournamentQuestionStatus;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly windowEndsAt: string;
  readonly expiryAt: string;
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
      kind: question.kind,
      unit: question.unit,
      storedStatus: question.storedStatus,
      status: effectiveStatus(question, now),
      opensAt: question.opensAt.toISOString(),
      closesAt: question.closesAt.toISOString(),
      windowEndsAt: windowEnd(question).toISOString(),
      expiryAt: question.expiryAt.toISOString(),
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
