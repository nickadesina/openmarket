import { ServiceError } from "../../../../lib/api/errors.js";
import { assertOnlyQueryParameters, parseOptionalString } from "../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import {
  getLeaderboard,
  LEADERBOARD_PERIOD_PATTERN,
} from "../../../../lib/services/tournament/leaderboard.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withReadRoute(
    request,
    async (context) => {
      const searchParams = new URL(request.url).searchParams;
      assertOnlyQueryParameters(searchParams, ["period"]);
      const period = parseOptionalString(searchParams, "period", { maximumLength: 7 }) ?? "all";
      if (!LEADERBOARD_PERIOD_PATTERN.test(period)) {
        throw new ServiceError("INVALID_INPUT", "Period must be all or YYYY-MM.", {
          parameter: "period",
        });
      }
      const leaderboard = await getLeaderboard(context.db, period);
      return jsonSuccess(leaderboard, { requestId: context.requestId });
    },
    { cacheSeconds: 10 },
  );
}
