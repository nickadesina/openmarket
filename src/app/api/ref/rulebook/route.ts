import { withRefRoute } from "../../../../lib/api/ref-route.js";
import { getRulebook } from "../../../../lib/services/dealer/get-rulebook.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withRefRoute(request, [], (context) => getRulebook(context.now));
}
