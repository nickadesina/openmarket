import type { Kysely } from "kysely";

import { ServiceError } from "../api/errors.js";
import type { Database, MetricKind } from "../db/schema.js";
import { calculateTimeWeightedAverage } from "../engine/twap.js";
import type { OrderedMark } from "../engine/types.js";
import {
  downsampleMarks,
  type DownsampleMarkPoint,
} from "./downsample-marks.js";

export type MarkRange = "1h" | "1d" | "1w" | "all";

export interface MarkPoint extends DownsampleMarkPoint {}

export interface GetMarksOptions {
  readonly now?: Date;
  readonly maxPoints?: number;
}

export interface MarkHistory {
  readonly marketId: string;
  readonly slug: string;
  readonly range: MarkRange;
  readonly metricKind: MetricKind;
  readonly currentMetric: number;
  /** Metric level in force at windowStart: the latest mark at or before it,
   *  else the first mark, else the current metric. The same baseline rule
   *  list-markets uses for the 24-hour change. */
  readonly openValue: number;
  readonly mark60Minutes: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly points: MarkPoint[];
}

interface MarkRow {
  readonly market_sequence: string;
  readonly ts: Date;
  readonly value: number;
}

const RANGE_MS: Record<Exclude<MarkRange, "all">, number> = {
  "1h": 60 * 60 * 1_000,
  "1d": 24 * 60 * 60 * 1_000,
  "1w": 7 * 24 * 60 * 60 * 1_000,
};
const DEFAULT_MAX_POINTS = 1_000;
const MAX_MAX_POINTS = 10_000;
const TWAP_WINDOW_MS = 60 * 60 * 1_000;

function normalizeRange(range: MarkRange): MarkRange {
  if (range !== "1h" && range !== "1d" && range !== "1w" && range !== "all") {
    throw new ServiceError(
      "INVALID_INPUT",
      "Mark range must be one of 1h, 1d, 1w, or all.",
    );
  }
  return range;
}

function normalizeOptions(options: GetMarksOptions): {
  readonly now: Date;
  readonly maxPoints: number;
} {
  const now = options.now === undefined ? new Date() : new Date(options.now.getTime());
  if (!Number.isFinite(now.getTime())) {
    throw new ServiceError("INVALID_INPUT", "Read clock must be a valid date.");
  }
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
  if (
    !Number.isSafeInteger(maxPoints) ||
    maxPoints < 2 ||
    maxPoints > MAX_MAX_POINTS
  ) {
    throw new ServiceError(
      "INVALID_INPUT",
      `maxPoints must be an integer from 2 through ${MAX_MAX_POINTS}.`,
    );
  }
  return { now, maxPoints };
}

function sequenceNumber(sequence: string): number {
  if (!/^\d+$/.test(sequence)) {
    throw new ServiceError("INVALID_INPUT", "Stored mark sequence is invalid.");
  }
  const parsed = Number(sequence);
  if (!Number.isSafeInteger(parsed)) {
    throw new ServiceError("INVALID_INPUT", "Stored mark sequence is too large.");
  }
  return parsed;
}

function orderedMark(row: MarkRow): OrderedMark {
  return {
    marketSequence: sequenceNumber(row.market_sequence),
    timestamp: new Date(row.ts.getTime()),
    value: row.value,
  };
}

function laterMark(left: MarkRow | null, right: MarkRow): MarkRow {
  if (left === null) {
    return right;
  }
  const timestampDifference = right.ts.getTime() - left.ts.getTime();
  if (timestampDifference > 0) {
    return right;
  }
  if (
    timestampDifference === 0 &&
    BigInt(right.market_sequence) > BigInt(left.market_sequence)
  ) {
    return right;
  }
  return left;
}

export async function getMarks(
  db: Kysely<Database>,
  slug: string,
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
        .innerJoin("companies", "companies.id", "markets.company_id")
        .select([
          "markets.id as market_id",
          "markets.metric_kind as metric_kind",
          "markets.current_metric as current_metric",
          "markets.created_at as created_at",
          "companies.slug as slug",
        ])
        .where("companies.slug", "=", slug)
        .orderBy("markets.created_at", "desc")
        .orderBy("markets.id", "desc")
        .executeTakeFirst();

      if (market === undefined) {
        throw new ServiceError("MARKET_NOT_FOUND", "Market was not found.");
      }

      const requestedWindowMs = range === "all" ? null : RANGE_MS[range];
      const windowStart =
        requestedWindowMs === null
          ? new Date(market.created_at.getTime())
          : new Date(now.getTime() - requestedWindowMs);

      const [priorRow, rows] = await Promise.all([
        transaction
          .selectFrom("marks")
          .select(["market_sequence", "ts", "value"])
          .where("market_id", "=", market.market_id)
          .where("ts", "<=", windowStart)
          .orderBy("ts", "desc")
          .orderBy("market_sequence", "desc")
          .executeTakeFirst(),
        transaction
          .selectFrom("marks")
          .select(["market_sequence", "ts", "value"])
          .where("market_id", "=", market.market_id)
          .where("ts", ">=", windowStart)
          .where("ts", "<=", now)
          .orderBy("ts", "asc")
          .orderBy("market_sequence", "asc")
          .execute(),
      ]);

      const twapStart = now.getTime() - TWAP_WINDOW_MS;
      let twapPrior: MarkRow | null =
        priorRow !== undefined && priorRow.ts.getTime() <= twapStart
          ? priorRow
          : null;
      const twapRows: MarkRow[] = [];
      for (const row of rows) {
        const timestamp = row.ts.getTime();
        if (timestamp <= twapStart) {
          twapPrior = laterMark(twapPrior, row);
        } else if (timestamp <= now.getTime()) {
          twapRows.push(row);
        }
      }

      const mark60Minutes = calculateTimeWeightedAverage({
        priorMark: twapPrior === null ? null : orderedMark(twapPrior),
        marks: twapRows.map(orderedMark),
        currentMetric: market.current_metric,
        now,
      });
      const rawPoints: MarkPoint[] = rows.map((row) => ({
        timestamp: row.ts.toISOString(),
        marketSequence: row.market_sequence,
        value: row.value,
      }));
      const points =
        range === "1w" || range === "all"
          ? downsampleMarks(rawPoints, maxPoints)
          : rawPoints;

      return {
        marketId: market.market_id,
        slug: market.slug,
        range,
        metricKind: market.metric_kind,
        currentMetric: market.current_metric,
        openValue: priorRow?.value ?? rows[0]?.value ?? market.current_metric,
        mark60Minutes,
        windowStart: windowStart.toISOString(),
        windowEnd: now.toISOString(),
        points,
      };
    });
}
