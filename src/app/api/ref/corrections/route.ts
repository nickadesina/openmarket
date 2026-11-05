import { parseRefCursor, parseRefLimit, withRefRoute } from "../../../../lib/api/ref-route.js";
import { getRefCorrections } from "../../../../lib/services/index/ref-corrections.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withRefRoute(request, ["limit", "cursor"], (context) =>
    getRefCorrections(
      context.db,
      {
        limit: parseRefLimit(context.searchParams),
        cursor: parseRefCursor(context.searchParams),
      },
      { now: context.now },
    ),
  );
}
