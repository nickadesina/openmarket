import { parseRefInclude, withRefRoute } from "../../../../lib/api/ref-route.js";
import { getRefMethodology } from "../../../../lib/services/index/ref-methodology.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withRefRoute(request, ["include"], (context) =>
    getRefMethodology(
      context.db,
      { includeFamilies: parseRefInclude(context.searchParams, ["families"]) === "families" },
      { now: context.now },
    ),
  );
}
