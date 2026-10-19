"use client";

import { usePathname } from "next/navigation";

import { TournamentAccount } from "../tournament-nav/tournament-account.js";
import { AccountControl } from "./account-control.js";

/** Tournament pages sign in with X; everything else keeps the paper account. */
export function AccountSlot() {
  const pathname = usePathname();
  const tournament = pathname === "/t" || pathname.startsWith("/t/");
  return tournament ? <TournamentAccount /> : <AccountControl />;
}
