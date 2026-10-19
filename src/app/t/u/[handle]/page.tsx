import type { Metadata } from "next";

import { ForecasterPage } from "../../../../components/tournament-forecaster/forecaster-page.js";
import { getRuntimeDatabase } from "../../../../lib/db/runtime.js";
import {
  type ForecasterProfile,
  getForecaster,
} from "../../../../lib/services/tournament/forecaster.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ForecasterRouteProps {
  readonly params: Promise<{ readonly handle: string }>;
}

async function loadProfile(handle: string): Promise<ForecasterProfile | null> {
  if (!/^[A-Za-z0-9_]{1,50}$/.test(handle)) return null;
  try {
    return await getForecaster(getRuntimeDatabase(), handle);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: ForecasterRouteProps): Promise<Metadata> {
  const { handle } = await params;
  return { title: `@${handle}` };
}

export default async function ForecasterRoute({ params }: ForecasterRouteProps) {
  const { handle } = await params;
  return <ForecasterPage handle={handle} initialProfile={await loadProfile(handle)} />;
}
