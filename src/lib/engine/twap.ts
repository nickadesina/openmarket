import type { OrderedMark } from "./types.js";

const DEFAULT_WINDOW_MS = 60 * 60 * 1_000;

interface TimeWeightedAverageInput {
  readonly priorMark: OrderedMark | null;
  readonly marks: readonly OrderedMark[];
  readonly currentMetric: number;
  readonly now: Date;
  readonly windowMs?: number;
}

function timestampOf(date: Date, name: string): number {
  if (!(date instanceof Date)) {
    throw new RangeError(`${name} must be a Date`);
  }
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new RangeError(`${name} must be a valid timestamp`);
  }
  return timestamp;
}

function validateMetric(metric: number, name: string): void {
  if (!Number.isFinite(metric) || metric < 0) {
    throw new RangeError(`${name} must be a finite, non-negative metric`);
  }
}

function validateMark(mark: OrderedMark, name: string): number {
  if (!Number.isSafeInteger(mark.marketSequence) || mark.marketSequence < 0) {
    throw new RangeError(`${name}.marketSequence must be a non-negative safe integer`);
  }
  validateMetric(mark.value, `${name}.value`);
  return timestampOf(mark.timestamp, `${name}.timestamp`);
}

/**
 * Calculates the arithmetic time-weighted metric over the requested window.
 * Marks at the same timestamp are applied in market-sequence order.
 */
export function calculateTimeWeightedAverage({
  priorMark,
  marks,
  currentMetric,
  now,
  windowMs = DEFAULT_WINDOW_MS,
}: TimeWeightedAverageInput): number {
  validateMetric(currentMetric, "currentMetric");
  const nowTimestamp = timestampOf(now, "now");
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError("windowMs must be finite and positive");
  }

  const windowStart = nowTimestamp - windowMs;
  if (!Number.isFinite(windowStart)) {
    throw new RangeError("window start must be a finite timestamp");
  }

  if (priorMark !== null) {
    const priorTimestamp = validateMark(priorMark, "priorMark");
    if (priorTimestamp > windowStart) {
      throw new RangeError("priorMark must be at or before the window start");
    }
  }

  const marksWithTimestamps = marks.map((mark, index) => {
    const timestamp = validateMark(mark, `marks[${index}]`);
    if (timestamp < windowStart || timestamp > nowTimestamp) {
      throw new RangeError("marks must be inside the averaging window");
    }
    return { mark, timestamp };
  });

  if (marksWithTimestamps.length === 0) {
    return currentMetric;
  }

  marksWithTimestamps.sort(
    (left, right) =>
      left.timestamp - right.timestamp ||
      left.mark.marketSequence - right.mark.marketSequence,
  );

  let activeValue: number | null = priorMark?.value ?? null;
  let cursor = windowStart;
  let weightedAverage = 0;
  let coveredDuration = 0;

  const includeDuration = (value: number, duration: number): void => {
    if (duration <= 0) {
      return;
    }
    const nextCoveredDuration = coveredDuration + duration;
    weightedAverage +=
      (value - weightedAverage) * (duration / nextCoveredDuration);
    coveredDuration = nextCoveredDuration;
  };

  for (const { mark, timestamp } of marksWithTimestamps) {
    if (activeValue !== null) {
      includeDuration(activeValue, timestamp - cursor);
    }
    activeValue = mark.value;
    cursor = timestamp;
  }

  if (activeValue !== null) {
    includeDuration(activeValue, nowTimestamp - cursor);
  }

  return coveredDuration > 0 ? weightedAverage : currentMetric;
}
