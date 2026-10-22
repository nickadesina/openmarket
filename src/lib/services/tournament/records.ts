import { type Kysely, type Selectable, sql, type Transaction } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type {
  Database,
  TournamentAggregatesTable,
  TournamentProvider,
  TournamentQuestionKind,
  TournamentQuestionStatus,
  TournamentQuestionsTable,
  TournamentUnit,
} from "../../db/schema.js";
import { MIN_PUBLISHED_FORECASTERS } from "../../engine/tournament/aggregate.js";
import type { ForecastPoint } from "../../engine/tournament/forecast.js";

export type TournamentDb = Kysely<Database> | Transaction<Database>;
export type QuestionRow = Selectable<TournamentQuestionsTable>;

export interface QuestionRecord {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly descriptionMd: string;
  readonly rulebookMd: string;
  readonly rulebookVersion: number;
  readonly kind: TournamentQuestionKind;
  /** A forward's unit; null for a binary. */
  readonly unit: TournamentUnit | null;
  readonly opensAt: Date;
  readonly closesAt: Date;
  readonly expiryAt: Date;
  readonly closedAt: Date | null;
  readonly storedStatus: TournamentQuestionStatus;
  readonly minAccountAgeDays: number;
  readonly extremization: number;
  readonly xThreadUrl: string | null;
  readonly levelLabel: string | null;
  readonly voidNoteMd: string | null;
}

export function toQuestionRecord(row: QuestionRow): QuestionRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    descriptionMd: row.description_md,
    rulebookMd: row.rulebook_md,
    rulebookVersion: row.rulebook_version,
    kind: row.kind,
    unit: row.unit,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    expiryAt: row.expiry_at,
    closedAt: row.closed_at,
    storedStatus: row.status,
    minAccountAgeDays: row.min_account_age_days,
    extremization: row.extremization,
    xThreadUrl: row.x_thread_url,
    levelLabel: row.level_label,
    voidNoteMd: row.void_note_md,
  };
}

/** The end of the scoring window: a manual early close, else the scheduled close. */
export function windowEnd(question: QuestionRecord): Date {
  return question.closedAt ?? question.closesAt;
}

/** An open question past its close reads as closed without waiting for a job to move it. */
export function effectiveStatus(question: QuestionRecord, now: Date): TournamentQuestionStatus {
  if (question.storedStatus === "open" && now.getTime() >= windowEnd(question).getTime()) {
    return "closed";
  }
  return question.storedStatus;
}

export function acceptingForecasts(question: QuestionRecord, now: Date): boolean {
  return (
    question.storedStatus === "open" &&
    now.getTime() >= question.opensAt.getTime() &&
    now.getTime() < windowEnd(question).getTime()
  );
}

/** An archived numeric[] as numbers (pg parses its elements; strings are accepted too). */
export function toNumbers(values: readonly (string | number)[]): number[] {
  return values.map(Number);
}

export function nullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** A stored forecast's numeric columns; both null on a legacy (pre-013) event. */
export function toForecastPoint(row: {
  readonly p: string | null;
  readonly value: string | null;
}): ForecastPoint {
  return { p: nullableNumber(row.p), value: nullableNumber(row.value) };
}

/** Loads a public question by slug; drafts are invisible outside admin. */
export async function requireQuestion(
  db: TournamentDb,
  slug: string,
  options: { readonly includeDrafts?: boolean; readonly forUpdate?: boolean } = {},
): Promise<QuestionRecord> {
  let query = db.selectFrom("tournament_questions").selectAll().where("slug", "=", slug);
  if (options.forUpdate === true) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (row === undefined || (row.status === "draft" && options.includeDrafts !== true)) {
    throw new ServiceError("QUESTION_NOT_FOUND", "Question was not found.");
  }
  return toQuestionRecord(row);
}

export interface AggregateView {
  readonly computedAt: string;
  readonly nForecasters: number;
  /** False below the minimum forecaster count; `p` and `value` are then null. */
  readonly published: boolean;
  /** The binary crowd P(YES). */
  readonly p: number | null;
  /** The forward crowd median, in the question's unit. */
  readonly value: number | null;
}

/** An aggregate as published: the crowd figure is masked below the minimum forecaster count. */
export function aggregateView(
  computedAt: Date,
  nForecasters: number,
  crowd: ForecastPoint,
): AggregateView {
  const published = nForecasters >= MIN_PUBLISHED_FORECASTERS;
  return {
    computedAt: computedAt.toISOString(),
    nForecasters,
    published,
    p: published ? crowd.p : null,
    value: published ? crowd.value : null,
  };
}

export function toAggregateView(row: Selectable<TournamentAggregatesTable>): AggregateView {
  return aggregateView(row.computed_at, row.n_forecasters, toForecastPoint(row));
}

export async function latestAggregateRow(
  db: TournamentDb,
  questionId: string,
  before?: Date,
): Promise<Selectable<TournamentAggregatesTable> | undefined> {
  let query = db
    .selectFrom("tournament_aggregates")
    .selectAll()
    .where("question_id", "=", questionId);
  if (before !== undefined) query = query.where("computed_at", "<=", before);
  return query.orderBy("computed_at", "desc").orderBy("id", "desc").limit(1).executeTakeFirst();
}

export interface PublicIdentity {
  /** X handle, or the username of a password account; the two never share a profile URL. */
  readonly handle: string;
  readonly provider: TournamentProvider;
  /** The `/t/u/[slug]` segment: the X handle, or `~username` for a password account. */
  readonly profileSlug: string;
  /** Self-reported; null when none is stated. */
  readonly affiliation: string | null;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly verified: boolean;
  readonly flagged: boolean;
}

export async function databaseNow(db: TournamentDb): Promise<Date> {
  const { now } = await db
    // Millisecond precision so the instant round-trips through JavaScript and the event hash.
    .selectNoFrom(sql<Date>`date_trunc('milliseconds', clock_timestamp())`.as("now"))
    .executeTakeFirstOrThrow();
  return now;
}
