import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { WelcomeStep } from "../../../components/tournament-welcome/welcome-step.js";
import { welcomeContinuePath } from "../../../lib/auth/return-path.js";
import { TOURNAMENT_SESSION_COOKIE } from "../../../lib/auth/tournament-session.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "Welcome" };

interface WelcomeRouteProps {
  readonly searchParams: Promise<{ readonly return?: string }>;
}

/**
 * A new identity's one onboarding step. Without a session cookie there is no
 * one to welcome, so sign-in comes first; a cookie whose session has lapsed
 * is caught by the step's own viewer read.
 */
export default async function WelcomeRoute({ searchParams }: WelcomeRouteProps) {
  const [{ return: rawReturn }, cookieStore] = await Promise.all([searchParams, cookies()]);
  const returnTo = welcomeContinuePath(rawReturn);
  if (!cookieStore.has(TOURNAMENT_SESSION_COOKIE)) {
    redirect(`/t/signin?return=${encodeURIComponent(returnTo)}`);
  }
  return <WelcomeStep returnTo={returnTo} />;
}
