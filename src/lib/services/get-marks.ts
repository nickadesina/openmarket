import type { Kysely } from "kysely";

import { ServiceError } from "../api/errors.js";
import { archiveNow } from "../config/archive.js";
import type { Database, MetricKind } from "../db/schema.js";
import { latestMid } from "./dealer/dealer-books.js";
import { type DownsampleMarkPoint, downsampleMarks } from "./downsample-marks.js";

/**
 * `GET /api/markets/by-id/[marketId]/marks`: one book's marks over a range,
 * any epoch, live or settled. A forward book's marks are its mid in USD at
 * listing and at each fill; its current level is the latest model mid, so the
 * chart ends where the quote is.
 */

export type MarkRange = "1h" | "1d" | "1w" | "all";

export interface MarkPoint extends DownsampleMarkPoint {}

export interface GetMarksOptions {
  readonly now?: Date;
  readonly maxPoints?: number;
}

export interface MarkHistory {
  readonly marketId: string;
  readonly range: MarkRange;
  readonly metricKind: MetricKind;
  /** The book's level now: a forward's latest model mid in USD, a binary's YES price. */
  readonly currentMetric: number;
  /** Level in force at windowStart: the latest mark at or before it, else the
   *  first mark, else the current metric (DESIGN.md → The Baseline Rule). */
  readonly openValue: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly points: MarkPoint[];
}

const RANGE_MS: Record<Exclude<MarkRange, "all">, number> = {
  "1h": 60 * 60 * 1_000,
  "1d": 24 * 60 * 60 * 1_000,
  "1w": 7 * 24 * 60 * 60 * 1_000,
};
const DEFAULT_MAX_POINTS = 1_000;
const MAX_MAX_POINTS = 10_000;

function normalizeRange(range: MarkRange): MarkRange {
  if (range !== "1h" && range !== "1d" && range !== "1w" && range !== "all") {
    throw new ServiceError("INVALID_INPUT", "Mark range must be one of 1h, 1d, 1w, or all.");
  }
  return range;
}

function normalizeOptions(options: GetMarksOptions): {
  readonly now: Date;
  readonly maxPoints: number;
} {
  const now = options.now === undefined ? archiveNow() : new Date(options.now.getTime());
  if (!Number.isFinite(now.getTime())) {
    throw new ServiceError("INVALID_INPUT", "Read clock must be a valid date.");
  }
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 2 || maxPoints > MAX_MAX_POINTS) {
    throw new ServiceError(
      "INVALID_INPUT",
      `maxPoints must be an integer from 2 through ${MAX_MAX_POINTS}.`,
    );
  }
  return { now, maxPoints };
}

export async function getMarks(
  db: Kysely<Database>,
  marketId: string,
  rangeInput: MarkRange,
  options: GetMarksOptions = {},
): Promise<MarkHistory> {
  const range = normalizeRange(rangeInput);
  const { now, maxPoints } = normalizeOptions(options);

  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (transaction) => {
      const market = await transaction
        .selectFrom("markets")
        .select(["id", "metric_kind", "current_metric", "created_at", "instrument_id"])
        .where("id", "=", marketId)
        .executeTakeFirst();
      if (market === undefined) {
        throw new ServiceError("MARKET_NOT_FOUND", "Market was not found.");
      }

      // "All" opens at the book's first mark (its listing), never after the read clock.
      const firstMark =
        range === "all"
          ? await transaction
              .selectFrom("marks")
              .select("ts")
              .where("market_id", "=", market.id)
              .orderBy("ts", "asc")
              .orderBy("market_sequence", "asc")
              .executeTakeFirst()
          : undefined;
      const windowStart =
        range === "all"
          ? new Date(
              Math.min(firstMark?.ts.getTime() ?? market.created_at.getTime(), now.getTime()),
            )
          : new Date(now.getTime() - RANGE_MS[range]);

      const [priorRow, rows, mid] = await Promise.all([
        transaction
          .selectFrom("marks")
          .select(["market_sequence", "ts", "value"])
          .where("market_id", "=", market.id)
          .where("ts", "<=", windowStart)
          .orderBy("ts", "desc")
          .orderBy("market_sequence", "desc")
          .executeTakeFirst(),
        transaction
          .selectFrom("marks")
          .select(["market_sequence", "ts", "value"])
          .where("market_id", "=", market.id)
          .where("ts", ">=", windowStart)
          .where("ts", "<=", now)
          .orderBy("ts", "asc")
          .orderBy("market_sequence", "asc")
          .execute(),
        market.metric_kind === "forward_ln" && market.instrument_id !== null
          ? latestMid(transaction, market.instrument_id, now)
          : undefined,
      ]);

      const currentMetric =
        mid?.mid_ln === null || mid?.mid_ln === undefined
          ? market.current_metric
          : Math.exp(mid.mid_ln);
      const rawPoints: MarkPoint[] = rows.map((row) => ({
        timestamp: row.ts.toISOString(),
        marketSequence: row.market_sequence,
        value: row.value,
      }));
      const points =
        range === "1w" || range === "all"
          ? downsampleMarks(rawPoints, maxPoints, {
              start: windowStart.getTime(),
              end: now.getTime(),
            })
          : rawPoints;

      return {
        marketId: market.id,
        range,
        metricKind: market.metric_kind,
        currentMetric,
        openValue: priorRow?.value ?? rows[0]?.value ?? currentMetric,
        windowStart: windowStart.toISOString(),
        windowEnd: now.toISOString(),
        points,
      };
    });
}
