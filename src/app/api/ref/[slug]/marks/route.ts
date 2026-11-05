import { parseOptionalString, parseSlug } from "../../../../../lib/api/pagination.js";
import {
  parseRefCursor,
  parseRefInclude,
  parseRefLimit,
  withRefRoute,
} from "../../../../../lib/api/ref-route.js";
import { getRefMarks } from "../../../../../lib/services/index/ref-marks.js";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return withRefRoute(
    request,
    {
      parameters: ["limit", "cursor", "include", "label"],
      parse: (searchParams) => ({
        slug: parseSlug(slug),
        limit: parseRefLimit(searchParams),
        cursor: parseRefCursor(searchParams),
        include: parseRefInclude(searchParams, ["superseded"]) ?? ("live" as const),
        securityLabel: parseOptionalString(searchParams, "label", { maximumLength: 100 }),
      }),
    },
    (context) => {
      const { slug: valid, ...query } = context.query;
      return getRefMarks(context.db, valid, query, { now: context.now });
    },
  );
}
