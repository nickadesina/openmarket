import { parseSlug } from "../../../../lib/api/pagination.js";
import { withRefRoute } from "../../../../lib/api/ref-route.js";
import { getRefReference } from "../../../../lib/services/dealer/ref-reference.js";

export const runtime = "nodejs";

interface RefSlugRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

/** The name's reference forward and hazard with weights and components (README D14). */
export function GET(request: Request, routeContext: RefSlugRouteContext): Promise<Response> {
  return withRefRoute(request, [], async (context) => {
    const slug = parseSlug((await routeContext.params).slug);
    return getRefReference(context.db, slug, context.now);
  });
}
