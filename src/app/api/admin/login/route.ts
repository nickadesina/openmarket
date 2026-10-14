import { z } from "zod";

import { ServiceError } from "../../../../lib/api/errors.js";
import { parseMutationBody, withMutationRoute } from "../../../../lib/api/mutation-route.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import {
  ADMIN_COOKIE_MAX_AGE_MS,
  getAdminCookieSecret,
  signAdminCookie,
} from "../../../../lib/auth/admin-cookie.js";
import {
  getAdminPassphraseHash,
  verifyAdminPassphrase,
} from "../../../../lib/auth/admin-passphrase.js";
import { ADMIN_COOKIE_NAME } from "../../../../lib/auth/current-admin.js";
import {
  assertNetworkRateLimitAvailable,
  consumeNetworkRateLimit,
} from "../../../../lib/services/rate-limit.js";

export const runtime = "nodejs";

const adminLoginSchema = z
  .object({
    passphrase: z.string().min(1).max(1_024),
  })
  .strict();

function adminCookie(value: string): string {
  const attributes = [
    `${ADMIN_COOKIE_NAME}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(ADMIN_COOKIE_MAX_AGE_MS / 1_000)}`,
  ];
  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function POST(request: Request): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    // Only failed attempts consume quota, so a correct passphrase is never
    // throttled by its own successes; availability is still checked first.
    await assertNetworkRateLimitAvailable(context.db, "admin_login", request);
    const input = await parseMutationBody(request, adminLoginSchema, 8_192);
    const authenticated = await verifyAdminPassphrase(input.passphrase, getAdminPassphraseHash());
    if (!authenticated) {
      await consumeNetworkRateLimit(context.db, "admin_login", request);
      throw new ServiceError("ADMIN_REQUIRED", "Admin authentication failed.");
    }

    const cookieValue = signAdminCookie(getAdminCookieSecret());
    return jsonSuccess(
      { authenticated: true },
      {
        requestId: context.requestId,
        headers: { "Set-Cookie": adminCookie(cookieValue) },
      },
    );
  });
}
