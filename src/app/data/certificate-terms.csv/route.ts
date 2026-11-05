import { withCsvRoute } from "../../../lib/api/csv-route.js";
import { parseRefInclude } from "../../../lib/api/ref-route.js";
import { certificateTermsCsv } from "../../../lib/services/index/data-csv.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withCsvRoute(
    request,
    {
      parameters: ["include"],
      parse: (searchParams) => parseRefInclude(searchParams, ["superseded"]) === "superseded",
    },
    (context) =>
      certificateTermsCsv(context.db, { now: context.now, includeSuperseded: context.query }),
  );
}
