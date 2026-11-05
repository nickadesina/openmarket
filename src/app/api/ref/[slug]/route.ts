import { parseSlug } from "../../../../lib/api/pagination.js";
import { withRefRoute } from "../../../../lib/api/ref-route.js";
import { getRefName } from "../../../../lib/services/index/ref-name.js";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return withRefRoute(request, { parameters: [], parse: () => parseSlug(slug) }, (context) =>
    getRefName(context.db, context.query, { now: context.now }),
  );
}
