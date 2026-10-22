import { z } from "zod";

import { ServiceError } from "../../../../../../../lib/api/errors.js";
import {
  parseMutationBody,
  withMutationRoute,
} from "../../../../../../../lib/api/mutation-route.js";
import { assertOnlyQueryParameters } from "../../../../../../../lib/api/pagination.js";
import { jsonSuccess } from "../../../../../../../lib/api/response.js";
import { evidenceReviewSchema } from "../../../../../../../lib/api/tournament-schemas.js";
import { requireTournamentAdmin } from "../../../../../../../lib/auth/tournament-session.js";
import { reviewEvidence } from "../../../../../../../lib/services/tournament/evidence.js";

export const runtime = "nodejs";

interface ReviewRouteContext {
  readonly params: Promise<{ readonly flagId: string }>;
}

const flagIdSchema = z.uuid();

/** Confirms submitted evidence against a later independent flag, or rejects it. Admins only. */
export function POST(request: Request, routeContext: ReviewRouteContext): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    const reviewerUserId = await requireTournamentAdmin(context.db, request);
    assertOnlyQueryParameters(new URL(request.url).searchParams, []);
    const review = await parseMutationBody(request, evidenceReviewSchema, 2_048);
    const { flagId } = await routeContext.params;
    const parsed = flagIdSchema.safeParse(flagId);
    if (!parsed.success) throw new ServiceError("INVALID_INPUT", "Invalid flag id.");
    const result = await reviewEvidence(context.db, {
      flagId: parsed.data.toLowerCase(),
      reviewerUserId,
      review,
    });
    return jsonSuccess(result, { requestId: context.requestId });
  });
}
