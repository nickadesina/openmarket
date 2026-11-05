import { parseOptionalString } from "../../../../../lib/api/pagination.js";
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
  return withRefRoute(request, ["limit", "cursor", "include", "label"], (context) =>
    getRefMarks(
      context.db,
      slug,
      {
        limit: parseRefLimit(context.searchParams),
        cursor: parseRefCursor(context.searchParams),
        include: parseRefInclude(context.searchParams, ["superseded"]) ?? "live",
        securityLabel: parseOptionalString(context.searchParams, "label", { maximumLength: 100 }),
      },
      { now: context.now },
    ),
  );
}
