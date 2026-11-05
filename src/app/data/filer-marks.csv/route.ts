import { withCsvRoute } from "../../../lib/api/csv-route.js";
import { parseOptionalString, parseSlug } from "../../../lib/api/pagination.js";
import { parseRefInclude } from "../../../lib/api/ref-route.js";
import { filerMarksCsv } from "../../../lib/services/index/data-csv.js";

export const runtime = "nodejs";

/**
 * Every filer mark, streamed (Vercel's 4.5 MB response cap does not apply to
 * a streamed body; TECHNICAL_DESIGN.md, "Downloads"), or one name's with
 * `issuer=<slug>`, the file each name page links.
 */
export function GET(request: Request): Promise<Response> {
  return withCsvRoute(
    request,
    {
      parameters: ["include", "issuer"],
      parse: (searchParams) => {
        const issuer = parseOptionalString(searchParams, "issuer", { maximumLength: 100 });
        return {
          includeSuperseded: parseRefInclude(searchParams, ["superseded"]) === "superseded",
          issuerSlug: issuer === undefined ? undefined : parseSlug(issuer),
        };
      },
    },
    (context) => filerMarksCsv(context.db, { now: context.now, ...context.query }),
  );
}
