import { parseRefCursor, parseRefLimit, withRefRoute } from "../../../../lib/api/ref-route.js";
import { getRefCorrections } from "../../../../lib/services/index/ref-corrections.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withRefRoute(
    request,
    {
      parameters: ["limit", "cursor"],
      parse: (searchParams) => ({
        limit: parseRefLimit(searchParams),
        cursor: parseRefCursor(searchParams),
      }),
    },
    (context) => getRefCorrections(context.db, context.query, { now: context.now }),
  );
}
