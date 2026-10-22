import { parseSlug } from "../../../../../lib/api/pagination.js";
import {
  parseRefCursor,
  parseRefInstant,
  parseRefLimit,
  withRefRoute,
} from "../../../../../lib/api/ref-route.js";
import { getRefHistory } from "../../../../../lib/services/dealer/ref-history.js";

export const runtime = "nodejs";

interface RefHistoryRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

/** `?from=&to=&limit=&cursor=`: reference rows and the quote tape, oldest first. */
export function GET(request: Request, routeContext: RefHistoryRouteContext): Promise<Response> {
  return withRefRoute(request, ["from", "to", "limit", "cursor"], async (context) => {
    const { searchParams } = context;
    const from = parseRefInstant(searchParams, "from");
    const to = parseRefInstant(searchParams, "to");
    const cursor = parseRefCursor(searchParams);
    const slug = parseSlug((await routeContext.params).slug);
    return getRefHistory(
      context.db,
      slug,
      {
        limit: parseRefLimit(searchParams),
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
        ...(cursor === undefined ? {} : { cursor }),
      },
      context.now,
    );
  });
}
