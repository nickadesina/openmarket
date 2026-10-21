import type { Kysely } from "kysely";

import { IMPLIED_EV_ARR } from "../../config/tournament.js";
import type { Database } from "../../db/schema.js";
import {
  type AggregateView,
  latestAggregateRow,
  loadBuckets,
  nullableNumber,
  toAggregateView,
  toQuestionRecord,
} from "./records.js";

export interface DerivedInput {
  readonly slug: string;
  readonly available: boolean;
  /** "resolution" once the question has resolved to a value, else the live aggregate median. */
  readonly source: "aggregate" | "resolution" | null;
  readonly value: number | null;
  readonly aggregate: AggregateView | null;
}

export interface DerivedNumbers {
  /** Implied EV/ARR multiple: market cap (USD_T) × 1000 ÷ ARR (USD_B). */
  readonly impliedEvArr: number | null;
  readonly marketCap: DerivedInput;
  readonly arr: DerivedInput;
}

async function derivedInput(db: Kysely<Database>, slug: string): Promise<DerivedInput> {
  const row = await db
    .selectFrom("tournament_questions")
    .selectAll()
    .where("slug", "=", slug)
    .where("status", "<>", "draft")
    .executeTakeFirst();
  if (row === undefined) {
    return { slug, available: false, source: null, value: null, aggregate: null };
  }
  const question = toQuestionRecord(row);
  const buckets = await loadBuckets(db, question.id);
  const aggregateRow = await latestAggregateRow(db, question.id);
  const aggregate =
    aggregateRow === undefined ? null : toAggregateView(aggregateRow, question.unit, buckets);

  if (question.storedStatus === "resolved") {
    const resolution = await db
      .selectFrom("tournament_resolutions")
      .select("resolved_value")
      .where("question_id", "=", question.id)
      .where("superseded_by", "is", null)
      .executeTakeFirst();
    const value = nullableNumber(resolution?.resolved_value ?? null);
    return { slug, available: value !== null, source: "resolution", value, aggregate };
  }
  if (question.storedStatus === "voided") {
    return { slug, available: false, source: null, value: null, aggregate };
  }
  const value = aggregate?.medianValue ?? null;
  return { slug, available: value !== null, source: "aggregate", value, aggregate };
}

export async function getDerivedNumbers(db: Kysely<Database>): Promise<DerivedNumbers> {
  const [marketCap, arr] = await Promise.all([
    derivedInput(db, IMPLIED_EV_ARR.marketCapSlug),
    derivedInput(db, IMPLIED_EV_ARR.arrSlug),
  ]);
  const impliedEvArr =
    marketCap.value !== null && arr.value !== null && arr.value > 0
      ? (marketCap.value * 1000) / arr.value
      : null;
  return { impliedEvArr, marketCap, arr };
}
