import { withRefRoute } from "../../../../lib/api/ref-route.js";
import { getRefNames } from "../../../../lib/services/index/ref-names.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withRefRoute(request, [], (context) => getRefNames(context.db, { now: context.now }));
}
