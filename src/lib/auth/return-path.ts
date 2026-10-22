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
    return "/t";
  }
  return value;
}
