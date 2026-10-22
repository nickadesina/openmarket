"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useState } from "react";

import { safeReturnPath } from "../../lib/auth/return-path.js";
import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import { errorMessage } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { useTournamentViewer, xSignInHref } from "../../lib/client/tournament.js";
import styles from "./signin-page.module.css";

type Mode = "sign-in" | "create";

const PASSWORD_MIN_LENGTH = 10;

function failure(error: unknown): string {
  if (error instanceof ApiClientError && error.code === "INVALID_INPUT") {
    return `Usernames are 3–20 letters, numbers, or underscores; passwords at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return errorMessage(error, "Sign-in did not complete. Try again.");
}

/** X or a username and password, on one page; both land back where the visitor started. */
export function SignInPage({ returnTo: rawReturn }: { readonly returnTo: string | null }) {
  const returnTo = safeReturnPath(rawReturn);
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = useId();
  const viewer = useTournamentViewer();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      apiRequest(
        mode === "create" ? "/api/t/auth/password/register" : "/api/t/auth/password/login",
        {
          method: "POST",
          body: JSON.stringify({ username, password }),
        },
      ),
    onSuccess: async () => {
      setPassword("");
      // The identity owns the paper account too, so every cached read is stale.
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
      router.push(returnTo);
    },
  });

  const signedIn = viewer.data?.viewer != null;
  useEffect(() => {
    if (signedIn && !submit.isPending && !submit.isSuccess) router.replace(returnTo);
  }, [signedIn, submit.isPending, submit.isSuccess, returnTo, router]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit.mutate();
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Sign in</h1>
        <p>
          One account forecasts in the tournament and trades a $100,000 paper balance. Your name
          appears on every forecast and comment you make and on the leaderboard.
        </p>
      </header>

      <div className={styles.options}>
        <section className={styles.option} aria-labelledby={`${id}-x`}>
          <h2 className={styles.optionTitle} id={`${id}-x`}>
            With X
          </h2>
          <p>Your X handle and avatar are shown. Only the public profile is read.</p>
          {viewer.data?.signIn.x === true ? (
            <a className={styles.primaryButton} href={xSignInHref(returnTo)}>
              Continue with X
            </a>
          ) : (
            <p className={styles.muted}>X sign-in is not configured on this deployment.</p>
          )}
        </section>

        <section className={styles.option} aria-labelledby={`${id}-password`}>
          <h2 className={styles.optionTitle} id={`${id}-password`}>
            With a username
          </h2>
          <div className={styles.modes} role="group" aria-label="Account">
            <button
              type="button"
              className={styles.mode}
              aria-pressed={mode === "sign-in"}
              onClick={() => {
                setMode("sign-in");
                submit.reset();
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={styles.mode}
              aria-pressed={mode === "create"}
              onClick={() => {
                setMode("create");
                submit.reset();
              }}
            >
              Create account
            </button>
          </div>
          <form className={styles.form} onSubmit={onSubmit}>
            <label className={styles.field}>
              <span>Username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                pattern="[A-Za-z0-9_]{3,20}"
                minLength={3}
                maxLength={20}
                required
              />
            </label>
            <label className={styles.field}>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "create" ? "new-password" : "current-password"}
                minLength={mode === "create" ? PASSWORD_MIN_LENGTH : 1}
                maxLength={200}
                required
              />
            </label>
            {mode === "create" ? (
              <p className={styles.muted}>
                There is no email and no recovery: keep the password somewhere safe. Usernames show
                without an @, so they are never mistaken for X handles.
              </p>
            ) : null}
            <button type="submit" className={styles.primaryButton} disabled={submit.isPending}>
              {submit.isPending ? "Working…" : mode === "create" ? "Create account" : "Sign in"}
            </button>
            {submit.isError ? (
              <p className={styles.error} role="alert">
                {failure(submit.error)}
              </p>
            ) : null}
          </form>
        </section>
      </div>
    </div>
  );
}
