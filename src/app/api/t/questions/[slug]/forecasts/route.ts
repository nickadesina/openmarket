import { parseMutationBody, withMutationRoute } from "../../../../../../lib/api/mutation-route.js";
import { assertOnlyQueryParameters, parseSlug } from "../../../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../../lib/api/response.js";
import { forecastInputSchema } from "../../../../../../lib/api/tournament-schemas.js";
import { requireTournamentUserId } from "../../../../../../lib/auth/tournament-session.js";
import { listLatestForecasts } from "../../../../../../lib/services/tournament/get-question.js";
import { submitForecast } from "../../../../../../lib/services/tournament/submit-forecast.js";

export const runtime = "nodejs";

interface ForecastsRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

export function GET(request: Request, routeContext: ForecastsRouteContext): Promise<Response> {
  return withReadRoute(
    request,
    async (context) => {
      assertOnlyQueryParameters(new URL(request.url).searchParams, []);
      const { slug } = await routeContext.params;
      const forecasts = await listLatestForecasts(context.db, parseSlug(slug));
      return jsonSuccess(forecasts, { requestId: context.requestId });
    },
    { cacheSeconds: 10 },
  );
}

export function POST(request: Request, routeContext: ForecastsRouteContext): Promise<Response> {
  return withMutationRoute(request, async (context) => {
    const { slug } = await routeContext.params;
    const userId = await requireTournamentUserId(context.db, request);
    const input = await parseMutationBody(request, forecastInputSchema, 4_096);
    const stored = await submitForecast(context.db, {
      slug: parseSlug(slug),
      userId,
      probs: input.probs,
      clientHash: input.client_hash,
    });
    return jsonSuccess(stored, { requestId: context.requestId });
  });
}
