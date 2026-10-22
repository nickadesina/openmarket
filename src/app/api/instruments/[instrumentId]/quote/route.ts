import { ServiceError } from "../../../../../lib/api/errors.js";
import { assertOnlyQueryParameters } from "../../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { forwardQuoteQuerySchema } from "../../../../../lib/api/schemas.js";
import {
  readCookie,
  resolveTournamentSession,
  TOURNAMENT_SESSION_COOKIE,
} from "../../../../../lib/auth/tournament-session.js";
import {
  getInstrumentQuote,
  parseInstrumentId,
} from "../../../../../lib/services/dealer/get-instrument-quote.js";
import { consumeNetworkRateLimit } from "../../../../../lib/services/rate-limit.js";

export const runtime = "nodejs";

interface InstrumentQuoteRouteContext {
  readonly params: Promise<{ readonly instrumentId: string }>;
}

/**
 * The dealer's live quote on one instrument; `?side=long|short&notional_usd=`
 * previews a forward fill. Public, like an anonymous /api/quote buy, and
 * rate limited on the same per-network bucket; a signed-in restricted person
 * is refused the names they attested a tie to (RESTRICTED_PERSON).
 */
export function GET(
  request: Request,
  routeContext: InstrumentQuoteRouteContext,
): Promise<Response> {
  return withReadRoute(request, async (context) => {
    const searchParams = new URL(request.url).searchParams;
    assertOnlyQueryParameters(searchParams, ["side", "notional_usd"]);
    const parsed = forwardQuoteQuerySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
      throw new ServiceError("INVALID_INPUT", "side and notional_usd are invalid.");
    }
    const { instrumentId } = await routeContext.params;
    const id = parseInstrumentId(instrumentId);
    await consumeNetworkRateLimit(context.db, "quote", request);
    const session =
      readCookie(request, TOURNAMENT_SESSION_COOKIE) === null
        ? null
        : await resolveTournamentSession(context.db, request);
    const quote = await getInstrumentQuote(
      context.db,
      id,
      parsed.data,
      new Date(),
      session === null ? null : { tournamentUserId: session.userId },
    );
    return jsonSuccess(quote, { requestId: context.requestId });
  });
}
