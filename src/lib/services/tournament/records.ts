import { type Kysely, type Selectable, sql, type Transaction } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type {
  Database,
  TournamentAggregatesTable,
  TournamentProvider,
  TournamentQuestionStatus,
  TournamentQuestionsTable,
  TournamentUnit,
} from "../../db/schema.js";
import { MIN_PUBLISHED_FORECASTERS } from "../../engine/tournament/aggregate.js";
import { BINARY_YES_INDEX, type Bucket, floorIndex } from "../../engine/tournament/buckets.js";
import { type BucketMedian, bucketMedian } from "../../engine/tournament/median.js";

export type TournamentDb = Kysely<Database> | Transaction<Database>;
export type QuestionRow = Selectable<TournamentQuestionsTable>;

export interface QuestionRecord {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly descriptionMd: string;
  readonly rulebookMd: string;
  readonly rulebookVersion: number;
  readonly unit: TournamentUnit;
  readonly bucketCount: number;
  readonly opensAt: Date;
  readonly closesAt: Date;
  readonly expiryAt: Date;
  readonly closedAt: Date | null;
  readonly storedStatus: TournamentQuestionStatus;
  readonly minAccountAgeDays: number;
  readonly extremization: number;
  readonly xThreadUrl: string | null;
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
    unit: row.unit,
    bucketCount: row.bucket_count,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    expiryAt: row.expiry_at,
    closedAt: row.closed_at,
    storedStatus: row.status,
    minAccountAgeDays: row.min_account_age_days,
    extremization: row.extremization,
    xThreadUrl: row.x_thread_url,
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

export function toNumbers(values: readonly string[]): number[] {
  return values.map(Number);
}

export function nullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

export async function loadBuckets(db: TournamentDb, questionId: string): Promise<Bucket[]> {
  const rows = await db
    .selectFrom("tournament_buckets")
    .selectAll()
    .where("question_id", "=", questionId)
    .orderBy("index", "asc")
    .execute();
  return rows.map((row) => ({
    index: row.index,
    kind: row.kind,
    lower: nullableNumber(row.lower),
    upper: nullableNumber(row.upper),
    label: row.label,
  }));
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

export interface DerivedNumbers {
  readonly median: BucketMedian | null;
  readonly pFloor: number | null;
  readonly pYes: number | null;
}

export function deriveNumbers(
  unit: TournamentUnit,
  buckets: readonly Bucket[],
  probs: readonly number[],
): DerivedNumbers {
  const floor = floorIndex(buckets);
  return {
    median: unit === "bool" ? null : bucketMedian(buckets, probs),
    pFloor: floor === null ? null : probs[floor]!,
    pYes: unit === "bool" ? probs[BINARY_YES_INDEX]! : null,
  };
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

export function toAggregateView(
  row: Selectable<TournamentAggregatesTable>,
  unit: TournamentUnit,
  buckets: readonly Bucket[],
): AggregateView {
  const published = row.n_forecasters >= MIN_PUBLISHED_FORECASTERS && row.probs !== null;
  const probs = published ? toNumbers(row.probs!) : null;
  const derived = probs === null ? null : deriveNumbers(unit, buckets, probs);
  return {
    computedAt: row.computed_at.toISOString(),
    nForecasters: row.n_forecasters,
    published,
    probs,
    medianValue: published ? nullableNumber(row.median_value) : null,
    medianPosition: derived?.median?.position ?? null,
    pFloor: published ? nullableNumber(row.p_floor) : null,
    pYes: published ? nullableNumber(row.p_yes) : null,
    extremization: row.extremization,
    weightingVersion: row.weighting_version,
  };
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
