import { ServiceError } from "../../../../../lib/api/errors.js";
import { assertOnlyQueryParameters } from "../../../../../lib/api/pagination.js";
import { withReadRoute } from "../../../../../lib/api/request-context.js";
import { jsonSuccess } from "../../../../../lib/api/response.js";
import { getProvenanceProof } from "../../../../../lib/services/tournament/provenance.js";
import { solanaCluster } from "../../../../../lib/solana/memo.js";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface ProvenanceRouteContext {
  readonly params: Promise<{ readonly eventId: string }>;
}

/** A forecast's hash, its hourly batch, the Solana memo, and its Merkle path. */
export function GET(request: Request, routeContext: ProvenanceRouteContext): Promise<Response> {
  return withReadRoute(
    request,
    async (context) => {
      assertOnlyQueryParameters(new URL(request.url).searchParams, []);
      const { eventId } = await routeContext.params;
      if (!UUID.test(eventId)) {
        throw new ServiceError("INVALID_INPUT", "Invalid forecast id.", { parameter: "eventId" });
      }
      const proof = await getProvenanceProof(context.db, eventId, solanaCluster());
      return jsonSuccess(proof, { requestId: context.requestId });
    },
    { cacheSeconds: 10 },
  );
}
