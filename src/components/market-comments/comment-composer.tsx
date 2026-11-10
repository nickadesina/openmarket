"use client";

import { useEffect, useId, useRef, useState } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import { formatForecasterName } from "../../lib/client/format.js";
import type { CommentAuthor, MarketComment } from "../../lib/services/list-comments.js";
import styles from "./market-comments.module.css";
import { commentsPath } from "./use-comment-thread.js";

/** The signed-in paper account and the tournament identity its comments carry. */
export interface CommentIdentity {
  readonly userId: string;
  readonly identity: CommentAuthor;
}

function nameOf(account: CommentIdentity): string {
  return formatForecasterName(account.identity);
}

export interface CommentIdentityState {
  readonly identity: CommentIdentity | null;
  readonly checking: boolean;
  readonly unavailable: boolean;
  readonly refresh: () => Promise<CommentIdentity | null>;
}

interface CommentComposerProps {
  readonly marketId: string;
  readonly parentId: string | null;
  readonly account: CommentIdentityState;
  readonly onPosted: (comment: MarketComment) => void;
  readonly onCancel?: () => void;
}

interface Submission {
  readonly body: string;
  readonly parentId?: string;
  readonly clientRequestId: string;
  readonly expectedUserId: string;
}

export function CommentComposer({
  marketId,
  parentId,
  account,
  onPosted,
  onCancel,
}: CommentComposerProps) {
  const id = useId();
  const inputId = `comment-draft-${id}`;
  const [body, setBody] = useState("");
  const [owner, setOwner] = useState<CommentIdentity | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [posting, setPosting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [mustAdopt, setMustAdopt] = useState(false);
  const [refreshingIdentity, setRefreshingIdentity] = useState(false);
  const [identityRefreshFailed, setIdentityRefreshFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const inFlight = useRef(false);
  const identity = account.identity;
  const needsAdoption = body.length > 0 && (mustAdopt || owner?.userId !== identity?.userId);
  const frozen = submission !== null;
  const identityBlocked =
    account.checking || account.unavailable || refreshingIdentity || identityRefreshFailed;
  const canRetry =
    uncertain && submission !== null && submission.expectedUserId === identity?.userId;

  useEffect(() => {
    if (body.length > 0 && owner?.userId !== identity?.userId) setMustAdopt(true);
  }, [body.length, owner?.userId, identity?.userId]);

  async function refreshIdentity() {
    setRefreshingIdentity(true);
    setIdentityRefreshFailed(false);
    try {
      await account.refresh();
    } catch {
      setIdentityRefreshFailed(true);
    } finally {
      setRefreshingIdentity(false);
    }
  }

  async function handleFailure(failure: unknown, retryingUncertain: boolean) {
    if (failure instanceof ApiClientError && failure.code === "ACCOUNT_CHANGED") {
      // A rejected retry does not disprove an earlier uncertain commit.
      if (!retryingUncertain) setSubmission(null);
      setMustAdopt(true);
      setError("The active account changed. Your draft has not been reassigned.");
      await refreshIdentity();
      return;
    }
    if (
      !(failure instanceof ApiClientError) ||
      failure.status === 0 ||
      failure.status >= 500 ||
      failure.code === "INVALID_RESPONSE"
    ) {
      setUncertain(true);
      setError(
        "We could not confirm whether your comment was posted. Retry the same submission to avoid posting it twice.",
      );
      return;
    }
    if (!retryingUncertain) {
      setSubmission(null);
      setUncertain(false);
    }
    if (failure.code === "USER_REQUIRED") {
      setMustAdopt(true);
      setError("Sign in, then explicitly adopt and post your saved draft.");
      await refreshIdentity();
      return;
    }
    if (failure.code === "RATE_LIMITED") {
      const seconds = failure.details.retryAfterSeconds;
      setError(
        typeof seconds === "number"
          ? `Posting too quickly. Wait ${Math.ceil(seconds)} seconds before trying again. Your draft is saved.`
          : "Posting too quickly. Wait a moment before trying again. Your draft is saved.",
      );
      return;
    }
    setError(failure.message);
  }

  async function post() {
    if (inFlight.current || identity === null || identityBlocked) return;
    if (submission === null && (needsAdoption || body.trim().length === 0)) return;
    if (submission !== null && !canRetry) return;

    const payload: Submission = submission ?? {
      body: body.trim(),
      ...(parentId === null ? {} : { parentId }),
      clientRequestId: crypto.randomUUID(),
      expectedUserId: identity.userId,
    };
    const retryingUncertain = uncertain;
    inFlight.current = true;
    setPosting(true);
    setSubmission(payload);
    setError(null);
    setStatus("");
    try {
      const comment = await apiRequest<MarketComment>(commentsPath(marketId, null, null), {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onPosted(comment);
      setBody("");
      setOwner(null);
      setSubmission(null);
      setUncertain(false);
      setMustAdopt(false);
      setStatus(
        comment.removedAt === null
          ? parentId === null
            ? "Comment posted."
            : "Reply posted."
          : "This comment was posted and has since been removed.",
      );
    } catch (failure) {
      await handleFailure(failure, retryingUncertain);
    } finally {
      inFlight.current = false;
      setPosting(false);
    }
  }

  function abandon() {
    setSubmission(null);
    setUncertain(false);
    setError(null);
    setStatus(
      "Retry abandoned. The earlier submission may already be visible; check before posting again.",
    );
    document.getElementById(inputId)?.focus();
  }

  function identityMessage() {
    if (refreshingIdentity || account.checking)
      return "Checking the active account… Your draft is kept here.";
    if (identityBlocked) return "Account confirmation is unavailable. Your draft is kept here.";
    if (identity === null) return "You can draft now. Sign in before posting.";
    if (!needsAdoption) return `Posting as ${nameOf(identity)}.`;
    return owner === null
      ? `Your draft is not assigned to ${nameOf(identity)}. Adopt it explicitly before posting.`
      : `This draft belongs to ${nameOf(owner)}. The active account is now ${nameOf(identity)}.`;
  }

  function renderAccountAction() {
    if (identityBlocked) {
      return (
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={posting || refreshingIdentity || account.checking}
          onClick={() => void refreshIdentity()}
        >
          {refreshingIdentity || account.checking ? "Checking account…" : "Retry account check"}
        </button>
      );
    }
    if (identity === null) {
      return <span>Comments are closed in the archive.</span>;
    }
    if (!needsAdoption || frozen) return null;
    return (
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={posting}
        onClick={() => {
          setOwner(identity);
          setMustAdopt(false);
          setError(null);
          setStatus(`Draft adopted by ${nameOf(identity)}. Review it, then press Post.`);
          document.getElementById(inputId)?.focus();
        }}
      >
        Use draft as {nameOf(identity)}
      </button>
    );
  }

  function renderSubmissionActions() {
    if (uncertain) {
      return (
        <>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={posting || !canRetry || identityBlocked}
          >
            {posting ? "Retrying…" : "Retry same submission"}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={posting}
            onClick={abandon}
          >
            Abandon retry and edit
          </button>
        </>
      );
    }
    return (
      <button
        type="submit"
        className={styles.primaryButton}
        disabled={
          posting ||
          identity === null ||
          identityBlocked ||
          needsAdoption ||
          body.trim().length === 0
        }
      >
        {posting ? "Posting…" : parentId === null ? "Post comment" : "Post reply"}
      </button>
    );
  }

  return (
    <form
      className={styles.composer}
      aria-label={parentId === null ? "Write a comment" : "Write a reply"}
      onSubmit={(event) => {
        event.preventDefault();
        void post();
      }}
    >
      <label className={styles.label} htmlFor={inputId}>
        {parentId === null ? "Add a comment" : "Add a reply"}
      </label>
      <textarea
        id={inputId}
        className={styles.input}
        rows={3}
        maxLength={2000}
        value={body}
        readOnly={frozen}
        aria-describedby={`${id}-help ${id}-identity ${id}-error`}
        onChange={(event) => {
          const next = event.target.value;
          if (body.length === 0) setOwner(identity);
          if (next.length === 0) {
            setOwner(null);
            setMustAdopt(false);
          }
          setBody(next);
          setError(null);
          setStatus("");
        }}
      />
      <div className={styles.composerMeta}>
        <p id={`${id}-help`}>Plain text · public · 2,000 characters maximum</p>
        <span>{body.length}/2000 characters</span>
      </div>
      <p id={`${id}-identity`} className={styles.identity}>
        {identityMessage()}
      </p>
      {parentId === null ? (
        <p className={styles.disclosure}>
          Comments show your tournament name: an @ handle from X, or a username without an @.
        </p>
      ) : null}
      {uncertain ? (
        <p className={styles.notice} role="status">
          This submitted text is locked until you retry or abandon it. Abandoning does not remove a
          comment that may already have posted.
          {submission?.expectedUserId !== identity?.userId
            ? " Switch back to the original account to retry, or abandon before adopting another account."
            : ""}
        </p>
      ) : null}
      <p id={`${id}-error`} className={styles.error} role="alert">
        {error}
      </p>
      <div className={styles.actions}>
        {renderAccountAction()}
        {renderSubmissionActions()}
        {onCancel !== undefined ? (
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={posting}
            onClick={onCancel}
          >
            Hide draft
          </button>
        ) : null}
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
