import { assertOnlyQueryParameters } from "../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../lib/api/response.js";
import { requireTournamentAdmin } from "../../../../lib/auth/tournament-session.js";
import { getDealerAdmin } from "../../../../lib/services/dealer/get-dealer-admin.js";

export const runtime = "nodejs";

/** /admin/dealer's data: tournament admins only, never cached. */
export function GET(request: Request): Promise<Response> {
  return withReadRoute(request, async (context) => {
    assertOnlyQueryParameters(new URL(request.url).searchParams, []);
    await requireTournamentAdmin(context.db, request);
    const payload = await getDealerAdmin(context.db, new Date());
    return jsonSuccess(payload, { requestId: context.requestId });
  });
}
