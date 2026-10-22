"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useState } from "react";

import { safeReturnPath, welcomeHref } from "../../lib/auth/return-path.js";
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

/**
 * One primary path, X, and a username and password beneath it. A returning
 * sign-in lands back where the visitor started; a new account passes through
 * the welcome step first.
 */
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
    mutationFn: (submitted: Mode) =>
      apiRequest(
        submitted === "create" ? "/api/t/auth/password/register" : "/api/t/auth/password/login",
        {
          method: "POST",
          body: JSON.stringify({ username, password }),
        },
      ),
    onSuccess: async (_result, submitted) => {
      setPassword("");
      // The identity owns the paper account too, so every cached read is stale.
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
      // Registering always creates the identity, so it always onboards.
      router.push(submitted === "create" ? welcomeHref(returnTo) : returnTo);
    },
  });

  const signedIn = viewer.data?.viewer != null;
  useEffect(() => {
    if (signedIn && !submit.isPending && !submit.isSuccess) router.replace(returnTo);
  }, [signedIn, submit.isPending, submit.isSuccess, returnTo, router]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit.mutate(mode);
  }

  function choose(next: Mode) {
    setMode(next);
    submit.reset();
  }

  const xAvailable = viewer.data?.signIn.x === true;

  return (
    <div className={styles.page}>
      <section className={styles.panel} aria-labelledby={`${id}-title`}>
        <header className={styles.header}>
          <h1 id={`${id}-title`}>Sign in to forecast</h1>
          <p>
            A forecasting tournament on private-company milestones: each question asks for one
            number, the chance of YES or a dollar level.
          </p>
        </header>

        {viewer.isPending ? (
          <div className={styles.xSkeleton} role="status" aria-label="Checking sign-in options" />
        ) : xAvailable ? (
          <div className={styles.xPath}>
            <a className={styles.xButton} href={xSignInHref(returnTo)}>
              Continue with X
            </a>
            <p className={styles.note}>
              Only your public X profile is read; your handle and avatar are shown.
            </p>
          </div>
        ) : null}

        <div className={styles.passwordPath}>
          <h2 className={styles.divider} id={`${id}-password`}>
            <span>{xAvailable ? "Or use a username" : "With a username"}</span>
          </h2>
          <div className={styles.modes} role="group" aria-labelledby={`${id}-password`}>
            <button
              type="button"
              className={styles.mode}
              aria-pressed={mode === "sign-in"}
              onClick={() => choose("sign-in")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={styles.mode}
              aria-pressed={mode === "create"}
              onClick={() => choose("create")}
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
              <p className={styles.note}>
                There is no email and no recovery: keep the password somewhere safe. Usernames show
                without an @, so they are never mistaken for X handles.
              </p>
            ) : null}
            <button
              type="submit"
              className={xAvailable ? styles.secondarySubmit : styles.primarySubmit}
              disabled={submit.isPending}
            >
              {submit.isPending ? "Working…" : mode === "create" ? "Create account" : "Sign in"}
            </button>
            {submit.isError ? (
              <p className={styles.error} role="alert">
                {failure(submit.error)}
              </p>
            ) : null}
          </form>
        </div>

        <p className={styles.footnote}>
          Your name appears on every forecast and comment you make and on the leaderboard.
        </p>
      </section>
    </div>
  );
}
