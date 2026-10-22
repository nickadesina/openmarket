import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { binaryScore, forwardScore } from "../engine/tournament/score.js";
import type { Viewer, ViewerForecast } from "../services/tournament/forecaster.js";
import { apiRequest } from "./api.js";
import type {
  BinaryScoreBounds,
  ForwardScoreLadder,
  WindowCoverage,
  WindowSpanUnit,
} from "./format.js";
import { queryKeys } from "./query-keys.js";

/** The forward preview's misses: exact, 10% either side, 2× either side. */
const FORWARD_MISS_RATIOS = [1, 1.1, 2] as const;

/** What a forward level scores if it settles exactly there, 10% off, or 2× off, from the engine. */
export function forwardScoreLadder(level: number): ForwardScoreLadder {
  return {
    level,
    rungs: FORWARD_MISS_RATIOS.map((ratio) => ({
      above: level * ratio,
      below: level / ratio,
      score: forwardScore(level, level * ratio),
    })),
  };
}

/** What 50% scores, and what the most certain allowed chance scores right and wrong. */
export function binaryScoreBounds(sure: number): BinaryScoreBounds {
  return {
    even: binaryScore(0.5, "yes"),
    sure,
    sureRight: binaryScore(sure, "yes"),
    sureWrong: binaryScore(sure, "no"),
  };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Days, or hours under two days, or minutes under two hours, so a count never reads "1 of 1". */
function spanUnit(windowMs: number): { readonly unit: WindowSpanUnit; readonly size: number } {
  if (windowMs < 2 * HOUR_MS) return { unit: "minute", size: MINUTE_MS };
  if (windowMs < 2 * DAY_MS) return { unit: "hour", size: HOUR_MS };
  return { unit: "day", size: DAY_MS };
}

/**
 * How much of the open window the viewer's forecast counts for. A forecast is
 * never withdrawn, so it counts from its first submission to the close; the
 * viewer payload carries the latest submission only, so after a revision the
 * figure is a lower bound. Without a forecast, it is what one submitted now
 * would cover. Null when the window has passed.
 */
export function windowCoverage(input: {
  readonly opensAt: string;
  readonly windowEndsAt: string;
  readonly now: number;
  readonly previous: Pick<ViewerForecast, "submittedAt" | "submissionCount"> | undefined;
}): WindowCoverage | null {
  const opens = Date.parse(input.opensAt);
  const ends = Date.parse(input.windowEndsAt);
  const from = Math.max(
    opens,
    input.previous === undefined ? input.now : Date.parse(input.previous.submittedAt),
  );
  if (!(ends > opens) || from >= ends) return null;
  const { unit, size } = spanUnit(ends - opens);
  const total = Math.max(1, Math.round((ends - opens) / size));
  return {
    unit,
    total,
    covered: Math.min(total, Math.round((ends - from) / size)),
    since: input.previous === undefined ? null : new Date(from).toISOString(),
    atLeast: input.previous !== undefined && input.previous.submissionCount > 1,
  };
}

export interface ViewerResponse {
  readonly viewer: Viewer | null;
  readonly isAdmin: boolean;
  readonly signIn: { readonly x: boolean; readonly password: boolean; readonly dev: boolean };
}

/** The signed-in tournament viewer; shared by the header, the submit widget, and admin. */
export function useTournamentViewer() {
  return useQuery({
    queryKey: queryKeys.tournamentViewer,
    queryFn: () => apiRequest<ViewerResponse>("/api/t/me"),
    staleTime: 30_000,
  });
}

/** Where the X sign-in round trip returns to. */
export function xSignInHref(returnTo: string): string {
  return `/api/t/auth/x/start?return=${encodeURIComponent(returnTo)}`;
}

/**
 * The current time, null until mounted: relative times ("in 3 days") render
 * only on the client so the server's clock never mismatches hydration.
 */
export function useNow(intervalMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The tournament's own sign-in page, returning to `returnTo` afterwards. */
export function signInHref(returnTo: string): string {
  return `/t/signin?return=${encodeURIComponent(returnTo)}`;
}

/** A forecaster's profile page; password accounts live under `~`. */
export function forecasterHref(identity: { readonly profileSlug: string }): string {
  return `/t/u/${identity.profileSlug}`;
}
