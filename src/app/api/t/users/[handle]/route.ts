import { ServiceError } from "../../../../../lib/api/errors.js";
import { assertOnlyQueryParameters } from "../../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { getForecaster } from "../../../../../lib/services/tournament/forecaster.js";

export const runtime = "nodejs";

interface UserRouteContext {
  readonly params: Promise<{ readonly handle: string }>;
}

export function GET(request: Request, routeContext: UserRouteContext): Promise<Response> {
  return withReadRoute(
    request,
    async (context) => {
      assertOnlyQueryParameters(new URL(request.url).searchParams, []);
      const { handle } = await routeContext.params;
      if (!/^~?[A-Za-z0-9_]{1,50}$/.test(handle)) {
        throw new ServiceError("INVALID_INPUT", "Invalid handle.", { parameter: "handle" });
      }
      const profile = await getForecaster(context.db, handle);
      return jsonSuccess(profile, { requestId: context.requestId });
    },
    { cacheSeconds: 10 },
  );
}
