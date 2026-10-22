import { parseSlug } from "../../../../../lib/api/pagination.js";
import { parseRefCursor, parseRefLimit, withRefRoute } from "../../../../../lib/api/ref-route.js";
import { getRefMids } from "../../../../../lib/services/dealer/ref-mids.js";

export const runtime = "nodejs";

interface RefMidsRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

/** The model's forecast log, unredacted, oldest first (README D14). */
export function GET(request: Request, routeContext: RefMidsRouteContext): Promise<Response> {
  return withRefRoute(request, ["limit", "cursor"], async (context) => {
    const cursor = parseRefCursor(context.searchParams);
    const slug = parseSlug((await routeContext.params).slug);
    return getRefMids(
      context.db,
      slug,
      { limit: parseRefLimit(context.searchParams), ...(cursor === undefined ? {} : { cursor }) },
      context.now,
    );
  });
}
