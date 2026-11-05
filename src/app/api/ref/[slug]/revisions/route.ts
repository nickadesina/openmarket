import { withRefRoute } from "../../../../../lib/api/ref-route.js";
import { getRefRevisions } from "../../../../../lib/services/index/ref-revisions.js";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return withRefRoute(request, [], (context) =>
    getRefRevisions(context.db, slug, { now: context.now }),
  );
}
