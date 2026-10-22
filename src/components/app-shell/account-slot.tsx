"use client";

import { usePathname } from "next/navigation";

import { TournamentAccount } from "../tournament-nav/tournament-account.js";

/** One identity everywhere; outside the tournament the control also shows paper cash. */
export function AccountSlot() {
  const pathname = usePathname();
  const tournament = pathname === "/t" || pathname.startsWith("/t/");
  return <TournamentAccount paperCash={!tournament} />;
}
