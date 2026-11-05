import { parseSlug } from "../../../../../lib/api/pagination.js";
import { withRefRoute } from "../../../../../lib/api/ref-route.js";
import { getRefSpv } from "../../../../../lib/services/index/ref-spv.js";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return withRefRoute(request, { parameters: [], parse: () => parseSlug(slug) }, (context) =>
    getRefSpv(context.db, context.query, { now: context.now }),
  );
}
