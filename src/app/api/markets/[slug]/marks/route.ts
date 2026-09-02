import {
  assertOnlyQueryParameters,
  parseRequiredEnum,
  parseSlug,
} from "../../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { getMarks, type MarkRange } from "../../../../../lib/services/get-marks.js";

export const runtime = "nodejs";

const MARK_RANGES = ["1h", "1d", "1w", "all"] as const satisfies readonly MarkRange[];

interface MarksRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

export function GET(request: Request, routeContext: MarksRouteContext): Promise<Response> {
  return withReadRoute(request, async (context) => {
    const searchParams = new URL(request.url).searchParams;
    assertOnlyQueryParameters(searchParams, ["range"]);
    const range = parseRequiredEnum(searchParams, "range", MARK_RANGES);
    const { slug: rawSlug } = await routeContext.params;
    const history = await getMarks(context.db, parseSlug(rawSlug), range);
    return jsonSuccess(history, { requestId: context.requestId });
  });
}
