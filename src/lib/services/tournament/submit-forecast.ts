import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import { ServiceError } from "../../api/errors.js";
import { FORECAST_RATE_LIMIT_MS } from "../../config/tournament.js";
import type { Database } from "../../db/schema.js";
import {
  canonicalProbs,
  ForecastError,
  normalizeForecast,
} from "../../engine/tournament/forecast.js";
import { recomputeAggregate } from "./aggregate.js";
import {
  acceptingForecasts,
  databaseNow,
  loadBuckets,
  requireQuestion,
  windowEnd,
} from "./records.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubmitForecastInput {
  readonly slug: string;
  readonly userId: string;
  readonly probs: readonly number[];
  readonly clientHash?: string | undefined;
}

export interface StoredForecast {
  readonly id: string;
  readonly questionSlug: string;
  readonly probs: number[];
  readonly submittedAt: string;
  readonly eventHash: string;
}

export function forecastEventHash(
  questionId: string,
  userId: string,
  submittedAt: Date,
  probs: readonly number[],
): string {
  return createHash("sha256")
    .update(questionId)
    .update(userId)
    .update(submittedAt.toISOString())
    .update(canonicalProbs(probs))
    .digest("hex");
}

/**
 * Appends one forecast event and the aggregate it produces. The question
 * row is locked for the transaction, so submissions to one question are
 * serialized: every aggregate row reflects every vector committed before it.
 */
export async function submitForecast(
  db: Kysely<Database>,
  input: SubmitForecastInput,
): Promise<StoredForecast> {
  return db.transaction().execute(async (transaction) => {
    const question = await requireQuestion(transaction, input.slug, { forUpdate: true });
    // Read the clock after the lock so the timestamp orders with the lock queue.
    const now = await databaseNow(transaction);
    if (!acceptingForecasts(question, now)) {
      throw new ServiceError(
        "QUESTION_NOT_OPEN",
        now.getTime() < question.opensAt.getTime()
          ? "This question is not open for forecasts yet."
          : "This question is closed to new forecasts.",
      );
    }

    const identity = await transaction
      .selectFrom("tournament_identities")
      .select(["provider_created_at"])
      .where("user_id", "=", input.userId)
      .orderBy("last_login_at", "desc")
      .executeTakeFirst();
    if (identity === undefined) {
      throw new ServiceError("USER_REQUIRED", "Sign in to submit a forecast.");
    }
    if (identity.provider_created_at !== null && question.minAccountAgeDays > 0) {
      const ageDays = (now.getTime() - identity.provider_created_at.getTime()) / DAY_MS;
      if (ageDays < question.minAccountAgeDays) {
        throw new ServiceError(
          "ACCOUNT_TOO_NEW",
          `This question accepts forecasts from X accounts at least ${question.minAccountAgeDays} days old.`,
          { minAccountAgeDays: question.minAccountAgeDays },
        );
      }
    }

    const previous = await transaction
      .selectFrom("tournament_forecast_events")
      .select("submitted_at")
      .where("question_id", "=", question.id)
      .where("user_id", "=", input.userId)
      .orderBy("submitted_at", "desc")
      .limit(1)
      .executeTakeFirst();
    if (previous !== undefined) {
      const elapsed = now.getTime() - previous.submitted_at.getTime();
      if (elapsed < FORECAST_RATE_LIMIT_MS) {
        throw new ServiceError("RATE_LIMITED", "One revision per question every 10 seconds.", {
          retryAfterSeconds: Math.max(1, Math.ceil((FORECAST_RATE_LIMIT_MS - elapsed) / 1_000)),
        });
      }
    }

    let probs: number[];
    try {
      probs = normalizeForecast(input.probs, question.bucketCount);
    } catch (error) {
      if (error instanceof ForecastError) throw new ServiceError("INVALID_INPUT", error.message);
      throw error;
    }

    const eventHash = forecastEventHash(question.id, input.userId, now, probs);
    const inserted = await transaction
      .insertInto("tournament_forecast_events")
      .values({
        user_id: input.userId,
        question_id: question.id,
        submitted_at: now,
        probs: probs.map((probability) => probability.toFixed(10)),
        client_hash: input.clientHash ?? null,
        event_hash: eventHash,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const buckets = await loadBuckets(transaction, question.id);
    await recomputeAggregate(transaction, question, buckets, now, windowEnd(question));

    return {
      id: inserted.id,
      questionSlug: question.slug,
      probs,
      submittedAt: now.toISOString(),
      eventHash,
    };
  });
}
