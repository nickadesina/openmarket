import { withRefRoute } from "../../../../lib/api/ref-route.js";
import { getRefListings } from "../../../../lib/services/dealer/ref-listings.js";

export const runtime = "nodejs";

/** Every listed name, its tier, live instruments, parameters and T (README D14). */
export function GET(request: Request): Promise<Response> {
  return withRefRoute(request, [], (context) => getRefListings(context.db, context.now));
}
