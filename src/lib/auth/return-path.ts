/** Where a sign-in lands when it carries no return path: the questions. */
export const DEFAULT_RETURN_PATH = "/t";

/** The one-step onboarding a newly created identity passes through. */
export const WELCOME_PATH = "/t/welcome";

/**
 * Only same-site page paths survive a sign-in round trip, so neither X nor the
 * sign-in page can be used as an open redirect: one leading slash, printable
 * ASCII, no backslash, never an API route or the sign-in page itself. Pure, so
 * the browser applies the same rule.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !/^\/(?![/\\])[\x21-\x7e]*$/.test(value) ||
    value.includes("\\") ||
    /^\/api(?:[/?#]|$)/.test(value) ||
    value.startsWith("/t/signin")
  ) {
    return DEFAULT_RETURN_PATH;
  }
  return value;
}

function isWelcomePath(path: string): boolean {
  return path === WELCOME_PATH || /^\/t\/welcome[/?#]/.test(path);
}

/**
 * Where the welcome step continues to: the safe return path, never the
 * welcome step itself, so Save and Skip cannot loop.
 */
export function welcomeContinuePath(value: string | null | undefined): string {
  const path = safeReturnPath(value);
  return isWelcomePath(path) ? DEFAULT_RETURN_PATH : path;
}

/** The welcome step for a new identity, carrying where it was headed. */
export function welcomeHref(returnTo: string | null | undefined): string {
  const next = welcomeContinuePath(returnTo);
  return next === DEFAULT_RETURN_PATH
    ? WELCOME_PATH
    : `${WELCOME_PATH}?return=${encodeURIComponent(next)}`;
}

/** Where a sign-in lands: the welcome step the first time, else its return path. */
export function signInLanding(returnTo: string | null | undefined, created: boolean): string {
  return created ? welcomeHref(returnTo) : safeReturnPath(returnTo);
}

/** A failed sign-in keeps the validated destination for the next attempt. */
export function signInFailure(returnTo: string | null, reason: "failed" | "unavailable"): string {
  return `/t/signin?return=${encodeURIComponent(safeReturnPath(returnTo))}&sign_in=${reason}`;
}
