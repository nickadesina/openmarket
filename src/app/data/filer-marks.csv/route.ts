import { withCsvRoute } from "../../../lib/api/csv-route.js";
import { parseRefInclude } from "../../../lib/api/ref-route.js";
import { filerMarksCsv } from "../../../lib/services/index/data-csv.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withCsvRoute(request, ["include"], (context) =>
    filerMarksCsv(context.db, {
      now: context.now,
      includeSuperseded: parseRefInclude(context.searchParams, ["superseded"]) === "superseded",
    }),
  );
}
