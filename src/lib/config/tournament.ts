/** Tournament policy constants and environment-backed settings. */

export const TOURNAMENT_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Sliding expiry is extended at most this often, so reads do not write on every request. */
export const TOURNAMENT_SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;

/** One submission per (user, question) per window. */
export const FORECAST_RATE_LIMIT_MS = 10_000;

/** Disputes may replace a resolution only inside this window from the first resolution. */
export const DISPUTE_WINDOW_MS = 72 * 60 * 60 * 1000;

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Admins are an allowlist of identities: bare numeric X user ids,
 * `password:<username>` for username accounts, or `dev:<id>` for
 * development sign-ins. Comma or whitespace separated.
 */
export function tournamentAdminIds(environment: Environment = process.env): ReadonlySet<string> {
  const raw = environment.TOURNAMENT_ADMIN_X_IDS ?? "";
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

export function adminKey(provider: "x" | "dev" | "password", providerUserId: string): string {
  return provider === "x" ? providerUserId : `${provider}:${providerUserId}`;
}

/**
 * The tournament bridge's linked questions (milestone 7) are opt-in: the
 * tournament asks only the questions written for it unless
 * `TOURNAMENT_LINKED_QUESTIONS=1`. Off, a listed instrument gets no question,
 * so its blend has no crowd and its name takes no evidence; settlement still
 * resolves any question an earlier run linked.
 */
export function linkedQuestionsEnabled(environment: Environment = process.env): boolean {
  return environment.TOURNAMENT_LINKED_QUESTIONS === "1";
}

/**
 * Development sign-in creates a `dev` identity without X. It exists only
 * under `next dev` with the flag set, so it can never run on a deployment.
 */
export function devSignInEnabled(environment: Environment = process.env): boolean {
  return environment.NODE_ENV === "development" && environment.TOURNAMENT_DEV_SIGN_IN === "1";
}
