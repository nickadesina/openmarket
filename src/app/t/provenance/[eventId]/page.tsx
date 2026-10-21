import { ProvenancePage } from "../../../../components/tournament-provenance/provenance-page.js";
import { getRuntimeDatabase } from "../../../../lib/db/runtime.js";
import {
  getProvenanceProof,
  type ProvenanceProof,
} from "../../../../lib/services/tournament/provenance.js";
import { solanaCluster } from "../../../../lib/solana/memo.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Timestamp proof" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface ProvenanceRouteProps {
  readonly params: Promise<{ readonly eventId: string }>;
}

async function loadProof(eventId: string): Promise<ProvenanceProof | null> {
  if (!UUID.test(eventId)) return null;
  try {
    return await getProvenanceProof(getRuntimeDatabase(), eventId, solanaCluster());
  } catch {
    return null;
  }
}

export default async function ProvenanceRoute({ params }: ProvenanceRouteProps) {
  const { eventId } = await params;
  return <ProvenancePage eventId={eventId} initialProof={await loadProof(eventId)} />;
}
