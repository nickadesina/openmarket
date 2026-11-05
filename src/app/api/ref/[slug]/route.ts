import { withRefRoute } from "../../../../lib/api/ref-route.js";
import { getRefName } from "../../../../lib/services/index/ref-name.js";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return withRefRoute(request, [], (context) => getRefName(context.db, slug, { now: context.now }));
}
