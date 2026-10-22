import { parseSlug } from "../../../../../lib/api/pagination.js";
import { parseRefCursor, parseRefLimit, withRefRoute } from "../../../../../lib/api/ref-route.js";
import { getRefFlags } from "../../../../../lib/services/dealer/ref-flags.js";

export const runtime = "nodejs";

interface RefFlagsRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

/** The public evidence the dealer reads for the name, oldest first (TECHNICAL_DESIGN.md §8). */
export function GET(request: Request, routeContext: RefFlagsRouteContext): Promise<Response> {
  return withRefRoute(request, ["limit", "cursor"], async (context) => {
    const cursor = parseRefCursor(context.searchParams);
    const slug = parseSlug((await routeContext.params).slug);
    return getRefFlags(
      context.db,
      slug,
      { limit: parseRefLimit(context.searchParams), ...(cursor === undefined ? {} : { cursor }) },
      context.now,
    );
  });
}
