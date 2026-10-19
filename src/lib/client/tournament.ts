import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { Viewer } from "../services/tournament/forecaster.js";
import { apiRequest } from "./api.js";
import { queryKeys } from "./query-keys.js";

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
