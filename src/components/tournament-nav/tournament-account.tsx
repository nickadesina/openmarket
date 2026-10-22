"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FormEvent, useState } from "react";

import { apiRequest } from "../../lib/client/api.js";
import { errorMessage, formatCents, formatForecasterName } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { forecasterHref, signInHref, useTournamentViewer, useTournamentSignOut } from "../../lib/client/tournament.js";
import { UserIcon } from "../icons/icons.js";
import styles from "./tournament-nav.module.css";

export function DevSignIn() {
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState("");
  const signIn = useMutation({
    mutationFn: () =>
      apiRequest<{ handle: string }>("/api/t/auth/dev", {
        method: "POST",
        body: JSON.stringify({ handle }),
      }),
    // A new identity changes the paper account too: refetch everything.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.all }),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (handle.length > 0) signIn.mutate();
  }

  return (
    <form className={styles.devForm} onSubmit={submit} aria-label="Development sign-in">
      <input
        className={styles.devInput}
        value={handle}
        onChange={(event) => setHandle(event.target.value)}
        pattern="[A-Za-z0-9_]{1,50}"
        placeholder="dev handle"
        aria-label="Development handle"
        required
      />
      <button className={styles.accountButton} type="submit" disabled={signIn.isPending}>
        Dev sign in
      </button>
      {signIn.isError ? (
        <span className={styles.accountError} role="alert">
          {errorMessage(signIn.error, "Sign-in failed.")}
        </span>
      ) : null}
    </form>
  );
}

/** The signed-in viewer's paper cash; the first read opens the account at $100,000. */
function PaperCash() {
  const portfolio = useQuery({
    queryKey: queryKeys.portfolio,
    queryFn: () =>
      apiRequest<{ readonly cashBalanceCents: string }>("/api/portfolio?offset=0&limit=1"),
  });
  // The comments module caches a signed-out read as null under the same key.
  if (portfolio.data == null) return null;
  return (
    <span className={`${styles.accountCash} ${styles.wideOnly}`}>
      {formatCents(portfolio.data.cashBalanceCents)} cash
    </span>
  );
}

/**
 * The header's account control: the tournament identity, the only one. Market
 * pages also show the identity's paper cash.
 */
export function TournamentAccount({ paperCash = false }: { readonly paperCash?: boolean }) {
  const pathname = usePathname();
  const viewerQuery = useTournamentViewer();
  const signOut = useTournamentSignOut();

  if (viewerQuery.isPending) {
    return <div className={styles.accountSkeleton} role="status" aria-label="Checking sign-in" />;
  }
  const data = viewerQuery.data;
  const viewer = data?.viewer ?? null;

  if (viewer !== null) {
    return (
      <div className={styles.account}>
        <Link
          className={styles.accountHandle}
          href={forecasterHref(viewer.identity)}
          aria-label={`${formatForecasterName(viewer.identity)}, your forecasts`}
        >
          <UserIcon />
          <span className={styles.wideOnly}>{formatForecasterName(viewer.identity)}</span>
        </Link>
        {paperCash ? <PaperCash /> : null}
        <button
          className={`${styles.accountButton} ${styles.wideOnly}`}
          type="button"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className={styles.account}>
      {pathname === "/t/signin" ? null : (
        <Link className={styles.signInButton} href={signInHref(pathname)}>
          Sign in
        </Link>
      )}
      {data?.signIn.dev === true ? (
        <span className={styles.wideOnly}>
          <DevSignIn />
        </span>
      ) : null}
    </div>
  );
}
