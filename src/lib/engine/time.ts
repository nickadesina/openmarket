import { assertDate } from "./assert.js";

export const DAY_MS = 86_400_000;

/** UTC calendar-day boundary, preserving the model's date arithmetic. */
export function utcMidnight(at: Date): number {
  assertDate(at, "at");
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}
