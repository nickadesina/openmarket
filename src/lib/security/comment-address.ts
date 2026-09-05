import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { ServiceError } from "../api/errors.js";
import { requireCookieSecret } from "../auth/user-cookie.js";

type Environment = Readonly<Record<string, string | undefined>>;

export function commentNetworkKey(
  request: Request,
  environment: Environment = process.env,
): string {
  let address: string;
  if (environment.VERCEL === "1") {
    // Vercel supplies this client address even when a proxy overrides x-forwarded-for.
    // https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
    const trusted = request.headers.get("x-vercel-forwarded-for")?.trim();
    const version = trusted === undefined ? 0 : isIP(trusted);
    if (trusted === undefined || trusted.includes("%") || version === 0) {
      throw new ServiceError("POSTING_UNAVAILABLE", "A trusted posting address is unavailable.");
    }
    address = version === 6 ? new URL(`http://[${trusted}]`).hostname.slice(1, -1) : trusted;
  } else if (environment.NODE_ENV === "development" || environment.NODE_ENV === "test") {
    // Local requests share one bucket; caller-controlled forwarding headers are ignored.
    address = "loopback";
  } else {
    throw new ServiceError("POSTING_UNAVAILABLE", "Comment posting requires a trusted deployment.");
  }

  const secret = requireCookieSecret(environment.USER_COOKIE_SECRET ?? "", "USER_COOKIE_SECRET");
  return createHmac("sha256", secret)
    .update("openmarket.comments.network.v1\0")
    .update(address)
    .digest("hex");
}
