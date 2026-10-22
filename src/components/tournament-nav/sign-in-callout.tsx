"use client";

import Link from "next/link";

import { signInHref, useTournamentViewer } from "../../lib/client/tournament.js";
import styles from "./tournament-nav.module.css";

/**
 * The questions list's one call to action for a signed-out visitor. Sign-in
 * returns here, through the welcome step for a new account.
 */
export function SignInCallout({ returnTo }: { readonly returnTo: string }) {
  const viewer = useTournamentViewer();
  if (!viewer.isSuccess || viewer.data.viewer !== null) return null;
  return (
    <div className={styles.callout}>
      <SignInExplanation />
      <Link className={styles.signInButton} href={signInHref(returnTo)}>
        Sign in to forecast
      </Link>
    </div>
  );
}

/** Shared explanation; the surrounding call to action keeps each page's existing label. */
export function SignInExplanation() {
  return (
    <p>
      <strong>Sign in to forecast.</strong> Use your X account, or a username and password; your
      name is how the leaderboard shows you.
    </p>
  );
}
