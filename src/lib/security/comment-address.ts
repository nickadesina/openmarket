import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { ServiceError } from "../api/errors.js";

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * The client address this deployment can trust, or null when none exists.
 * Caller-controlled forwarding headers are never trusted.
 */
export function trustedClientAddress(
  request: Request,
  environment: Environment = process.env,
): string | null {
  if (environment.VERCEL === "1") {
    // Vercel supplies this client address even when a proxy overrides x-forwarded-for.
    // https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
    const trusted = request.headers.get("x-vercel-forwarded-for")?.trim();
    const version = trusted === undefined ? 0 : isIP(trusted);
    if (trusted === undefined || trusted.includes("%") || version === 0) {
      return null;
    }
    return version === 6 ? new URL(`http://[${trusted}]`).hostname.slice(1, -1) : trusted;
  }
  if (environment.NODE_ENV === "development" || environment.NODE_ENV === "test") {
    // Local requests share one bucket; caller-controlled forwarding headers are ignored.
    return "loopback";
  }
  return null;
}

/**
 * The caller's posting bucket: a domain-separated SHA-256 of the trusted
 * address, the same unkeyed form the request quotas use, so raw addresses
 * are never stored.
 */
export function commentNetworkKey(
  request: Request,
  environment: Environment = process.env,
): string {
  const address = trustedClientAddress(request, environment);
  if (address === null) {
    throw new ServiceError(
      "POSTING_UNAVAILABLE",
      environment.VERCEL === "1"
        ? "A trusted posting address is unavailable."
        : "Comment posting requires a trusted deployment.",
    );
  }

  return createHash("sha256")
    .update("openmarket.comments.network.v2\0")
    .update(address)
    .digest("hex");
}
