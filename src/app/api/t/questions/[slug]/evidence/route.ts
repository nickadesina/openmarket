import { parseMutationBody, withMutationRoute } from "../../../../../../lib/api/mutation-route.js";
import { assertOnlyQueryParameters, parseSlug } from "../../../../../../lib/api/pagination.js";
import { jsonSuccess } from "../../../../../../lib/api/response.js";
import { evidenceInputSchema } from "../../../../../../lib/api/tournament-schemas.js";
import { requireTournamentUserId } from "../../../../../../lib/auth/tournament-session.js";
import {
  consumeNetworkRateLimit,
  consumeRateLimit,
  RATE_LIMIT_NETWORK_POLICIES,
} from "../../../../../../lib/services/rate-limit.js";
import { submitEvidence } from "../../../../../../lib/services/tournament/evidence.js";

export const runtime = "nodejs";

interface EvidenceRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

/**
 * Files a source on a question linked to a listed name's contract as a
 * low-confidence `user_submitted` flag for the admin queue. Tournament
 * sign-in; rate limited per forecaster and per network.
 */
export function POST(request: Request, routeContext: EvidenceRouteContext): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    assertOnlyQueryParameters(new URL(request.url).searchParams, []);
    const { slug } = await routeContext.params;
    const userId = await requireTournamentUserId(context.db, request);
    const input = await parseMutationBody(request, evidenceInputSchema, 4_096);
    await consumeRateLimit(context.db, "evidence", `user:${userId}`);
    await consumeNetworkRateLimit(
      context.db,
      "evidence",
      request,
      RATE_LIMIT_NETWORK_POLICIES.evidence,
      "network:",
    );
    const filed = await submitEvidence(context.db, {
      slug: parseSlug(slug),
      userId,
      evidence: input,
    });
    return jsonSuccess(filed.evidence, {
      requestId: context.requestId,
      ...(filed.replayed ? { headers: { "Idempotent-Replayed": "true" } } : {}),
    });
  });
}
