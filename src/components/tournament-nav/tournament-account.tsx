"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FormEvent, useState } from "react";

import { apiRequest } from "../../lib/client/api.js";
import { errorMessage } from "../../lib/client/format.js";
import { useTournamentViewer, xSignInHref } from "../../lib/client/tournament.js";
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["openmarket", "tournament"] }),
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

/** The header's account control on tournament pages: an X identity, not a paper account. */
export function TournamentAccount() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const viewerQuery = useTournamentViewer();
  const signOut = useMutation({
    mutationFn: () => apiRequest("/api/t/auth/logout", { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["openmarket", "tournament"] }),
  });

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
          href={`/t/u/${viewer.identity.handle}`}
          aria-label={`@${viewer.identity.handle}, your forecasts`}
        >
          <UserIcon />
          <span className={styles.wideOnly}>@{viewer.identity.handle}</span>
        </Link>
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
      {data?.signIn.x === true ? (
        <a className={styles.signInButton} href={xSignInHref(pathname)} aria-label="Sign in with X">
          <span className={styles.wideOnly}>Sign in with X</span>
          <span className={styles.narrowOnly}>Sign in</span>
        </a>
      ) : null}
      {data?.signIn.dev === true ? (
        <span className={styles.wideOnly}>
          <DevSignIn />
        </span>
      ) : null}
      {data !== undefined && !data.signIn.x && !data.signIn.dev ? (
        <span className={styles.accountMuted}>X sign-in is not configured</span>
      ) : null}
    </div>
  );
}
