import { withCsvRoute } from "../../../lib/api/csv-route.js";
import { spvMatchesCsv } from "../../../lib/services/index/data-csv.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withCsvRoute(request, [], (context) =>
    spvMatchesCsv(context.db, { now: context.now, includeSuperseded: false }),
  );
}
