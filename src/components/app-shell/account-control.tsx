"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import { formatCents } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { UserIcon } from "../icons/icons.js";
import styles from "./account-control.module.css";

interface PortfolioIdentity {
  readonly username: string;
  readonly cashBalanceCents: string;
}

/** Cross-page request for the app shell to reveal its shared username editor. */
export const OPEN_ACCOUNT_EDITOR_EVENT = "openmarket:open-account-editor";

export function AccountControl() {
  const queryClient = useQueryClient();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");

  const portfolioQuery = useQuery({
    queryKey: queryKeys.portfolio,
    queryFn: () => apiRequest<PortfolioIdentity>("/api/portfolio?offset=0&limit=1"),
  });

  const userMutation = useMutation({
    mutationFn: (nextUsername: string) =>
      apiRequest<{ readonly username: string; readonly cash_balance_cents: string }>("/api/user", {
        method: "POST",
        body: JSON.stringify({ username: nextUsername }),
      }),
    onSuccess(session) {
      // Seed the identity immediately; the invalidation refetches the authoritative portfolio.
      queryClient.setQueryData<PortfolioIdentity>(queryKeys.portfolio, {
        username: session.username,
        cashBalanceCents: session.cash_balance_cents,
      });
      setEditing(false);
      setUsername("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.portfolio });
      triggerRef.current?.focus();
    },
  });
  useEffect(() => {
    const openEditor = () => setEditing(true);
    window.addEventListener(OPEN_ACCOUNT_EDITOR_EVENT, openEditor);
    return () => window.removeEventListener(OPEN_ACCOUNT_EDITOR_EVENT, openEditor);
  }, []);

  const identity = portfolioQuery.data ?? null;

  function closeEditor() {
    setEditing(false);
    userMutation.reset();
    triggerRef.current?.focus();
  }

  function submitUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    userMutation.mutate(username);
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeEditor();
    }
  }

  if (portfolioQuery.isPending) {
    return (
      <div
        className={styles.skeleton}
        role="status"
        aria-label="Checking account"
      />
    );
  }

  const submitLabels = identity === null
    ? { idle: "Open account", pending: "Opening account…" }
    : { idle: "Use account", pending: "Switching account…" };
  const mutationError = userMutation.error;
  const errorMessage =
    mutationError instanceof ApiClientError
      ? mutationError.message
      : mutationError === null
        ? null
        : "Unable to open this account. Try again.";

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        className={styles.trigger}
        type="button"
        aria-expanded={editing}
        aria-controls={editing ? `${titleId}-panel` : undefined}
        onClick={() => {
          userMutation.reset();
          setEditing((current) => !current);
        }}
      >
        <UserIcon />
        {identity === null ? (
          <span className={styles.signedOutLabel}>Enter username</span>
        ) : (
          <span className={styles.accountText}>
            <span className={styles.username}>{identity.username}</span>
            <span className={styles.balance}>
              {formatCents(identity.cashBalanceCents)} cash
            </span>
          </span>
        )}
      </button>

      {editing ? (
        <form
          id={`${titleId}-panel`}
          className={styles.formPanel}
          aria-labelledby={titleId}
          onSubmit={submitUsername}
          onKeyDown={handlePanelKeyDown}
        >
          <h2 className={styles.formTitle} id={titleId}>
            {identity === null ? "Open your paper account" : "Change account"}
          </h2>
          <p className={styles.formHelp}>
            Enter a username to trade with a $100,000 paper balance.
          </p>
          <label className={styles.label} htmlFor={`${titleId}-username`}>
            Username
          </label>
          <input
            autoFocus
            className={styles.input}
            id={`${titleId}-username`}
            name="username"
            value={username}
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_]+"
            autoComplete="username"
            placeholder="letters, numbers, underscores"
            required
            aria-describedby={errorMessage === null ? undefined : `${titleId}-error`}
            aria-invalid={errorMessage === null ? undefined : true}
            onChange={(event) => setUsername(event.target.value)}
          />
          {errorMessage === null ? null : (
            <p className={styles.error} id={`${titleId}-error`} role="alert">
              {errorMessage}
            </p>
          )}
          <div className={styles.actions}>
            <button className={styles.cancel} type="button" onClick={closeEditor}>
              Cancel
            </button>
            <button
              className={styles.submit}
              type="submit"
              disabled={userMutation.isPending}
            >
              {submitLabels[userMutation.isPending ? "pending" : "idle"]}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
