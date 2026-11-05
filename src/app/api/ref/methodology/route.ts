import { parseRefInclude, withRefRoute } from "../../../../lib/api/ref-route.js";
import { getRefMethodology } from "../../../../lib/services/index/ref-methodology.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withRefRoute(
    request,
    {
      parameters: ["include"],
      parse: (searchParams) => ({
        includeFamilies: parseRefInclude(searchParams, ["families"]) === "families",
      }),
    },
    (context) => getRefMethodology(context.db, context.query, { now: context.now }),
  );
}
