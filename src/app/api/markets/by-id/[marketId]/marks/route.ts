import { ServiceError } from "../../../../../../lib/api/errors.js";
import { assertOnlyQueryParameters, parseRequiredEnum } from "../../../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../../lib/api/response.js";
import { marketIdSchema } from "../../../../../../lib/api/schemas.js";
import { getMarks, type MarkRange } from "../../../../../../lib/services/get-marks.js";

export const runtime = "nodejs";

const MARK_RANGES = ["1h", "1d", "1w", "all"] as const satisfies readonly MarkRange[];

interface MarksRouteContext {
  readonly params: Promise<{ readonly marketId: string }>;
}

/** One book's marks by market id: a live epoch's or a settled one's. */
export function GET(request: Request, routeContext: MarksRouteContext): Promise<Response> {
  return withReadRoute(request, async (context) => {
    const searchParams = new URL(request.url).searchParams;
    assertOnlyQueryParameters(searchParams, ["range"]);
    const range = parseRequiredEnum(searchParams, "range", MARK_RANGES);
    const { marketId } = await routeContext.params;
    const parsed = marketIdSchema.safeParse(marketId);
    if (!parsed.success) {
      throw new ServiceError("INVALID_INPUT", "Invalid market id.", { parameter: "marketId" });
    }
    const history = await getMarks(context.db, parsed.data, range);
    return jsonSuccess(history, { requestId: context.requestId });
  });
}
