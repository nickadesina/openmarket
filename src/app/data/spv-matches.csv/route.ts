import { withCsvRoute } from "../../../lib/api/csv-route.js";
import { parseOptionalString, parseSlug } from "../../../lib/api/pagination.js";
import { spvMatchesCsv } from "../../../lib/services/index/data-csv.js";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withCsvRoute(
    request,
    {
      parameters: ["issuer"],
      parse: (searchParams) => {
        const issuer = parseOptionalString(searchParams, "issuer", { maximumLength: 100 });
        return issuer === undefined ? undefined : parseSlug(issuer);
      },
    },
    (context) =>
      spvMatchesCsv(context.db, {
        now: context.now,
        includeSuperseded: false,
        issuerSlug: context.query,
      }),
  );
}
