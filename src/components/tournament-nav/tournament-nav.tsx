"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { apiRequest } from "../../lib/client/api.js";
import { forecasterHref, useTournamentViewer } from "../../lib/client/tournament.js";
import { SignInCallout } from "./sign-in-callout.js";
import { DevSignIn } from "./tournament-account.js";
import styles from "./tournament-nav.module.css";

/** The tournament's own section bar: separate from the markets, under /t. */
export function TournamentNav() {
  const pathname = usePathname();
  const viewer = useTournamentViewer();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => apiRequest("/api/t/auth/logout", { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["openmarket", "tournament"] }),
  });
  const links = [
    {
      href: "/t",
      label: "Questions",
      current: pathname === "/t" || pathname.startsWith("/t/q/"),
    },
    { href: "/t/leaderboard", label: "Leaderboard", current: pathname === "/t/leaderboard" },
    ...(viewer.data?.viewer != null
      ? [
          {
            href: forecasterHref(viewer.data.viewer.identity),
            label: "My forecasts",
            current:
              decodeURIComponent(pathname).toLowerCase() ===
              forecasterHref(viewer.data.viewer.identity).toLowerCase(),
          },
        ]
      : []),
    ...(viewer.data?.isAdmin === true
      ? [{ href: "/t/admin", label: "Admin", current: pathname === "/t/admin" }]
      : []),
  ];

  return (
    <>
      <div className={styles.bar}>
        <p className={styles.title}>
          <span className={styles.tab}>Forecasting tournament</span>
          <span className={styles.caption}>
            One number per question, scored. No money, no trading.
          </span>
        </p>
        <nav className={styles.nav} aria-label="Tournament">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${styles.link} ${link.current ? styles.linkActive : ""}`}
              aria-current={link.current ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
          {/* The header keeps only an icon at phone width; account actions live here. */}
          {viewer.data?.viewer != null ? (
            <button
              type="button"
              className={`${styles.link} ${styles.narrowOnly}`}
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
            >
              Sign out
            </button>
          ) : null}
        </nav>
        {viewer.data?.viewer == null && viewer.data?.signIn.dev === true ? (
          <div className={styles.narrowOnly}>
            <DevSignIn />
          </div>
        ) : null}
      </div>
      {/* The questions list is the front door; its editor-less page carries the sign-in. */}
      {pathname === "/t" ? <SignInCallout returnTo="/t" /> : null}
    </>
  );
}
