import { createHash, timingSafeEqual } from "node:crypto";

import { ServiceError } from "../api/errors.js";

/** A configured secret shorter than this refuses every caller. */
export const CRON_SECRET_MIN_LENGTH = 16;

/** The scheduler's key for one firing (GitHub: `${run_id}-${run_attempt}`). */
export const RUN_ID_HEADER = "x-run-id";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * The scheduled jobs' guard: the request must carry
 * `Authorization: Bearer $CRON_SECRET`, compared in constant time. Without
 * that secret configured, or with one under 16 characters, every caller is
 * refused.
 */
export function requireCronSecret(request: Request, job: string): void {
  const secret = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization") ?? "";
  if (
    secret === undefined ||
    secret.length < CRON_SECRET_MIN_LENGTH ||
    !timingSafeEqual(digest(supplied), digest(`Bearer ${secret}`))
  ) {
    throw new ServiceError("ADMIN_REQUIRED", `The ${job} job needs the cron secret.`);
  }
}
