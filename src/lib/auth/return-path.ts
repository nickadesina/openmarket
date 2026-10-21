/**
 * Only same-site tournament paths survive a sign-in round trip, so neither
 * X nor the sign-in page can be used as an open redirect. Pure, so the
 * browser applies the same rule.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !/^\/t(?:[/?#]|$)/.test(value) ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.startsWith("/t/signin")
  ) {
    return "/t";
  }
  return value;
}
