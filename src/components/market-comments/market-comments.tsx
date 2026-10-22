"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";

import { ApiClientError, apiRequest, requestPortfolioIdentity } from "../../lib/client/api.js";
import { formatDateTime, formatForecasterName } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { MarketComment } from "../../lib/services/list-comments.js";
import { ForecasterName } from "../tournament-forecaster-name/forecaster-name.js";
import { CommentComposer, type CommentIdentityState } from "./comment-composer.js";
import styles from "./market-comments.module.css";
import { type CommentThread, useCommentThread } from "./use-comment-thread.js";

function CommentText({ comment }: { readonly comment: MarketComment }) {
  return (
    <>
      <div className={styles.byline}>
        <strong>
          <ForecasterName identity={comment.author} />
        </strong>
        <time dateTime={comment.createdAt} title={comment.createdAt} suppressHydrationWarning>
          {formatDateTime(comment.createdAt)}
        </time>
      </div>
      {comment.removedAt === null ? (
        <p className={styles.body}>{comment.body}</p>
      ) : (
        <p className={styles.removed}>Comment removed</p>
      )}
    </>
  );
}

function ThreadState({
  thread,
  name,
}: {
  readonly thread: CommentThread;
  readonly name: "comments" | "replies";
}) {
  if (thread.query.isError) {
    return (
      <div className={styles.message} role="status">
        <p>
          {thread.query.data === undefined
            ? `Unable to load ${name}.`
            : `Unable to refresh ${name}. Showing the latest confirmed discussion.`}
        </p>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={thread.query.isFetching}
          onClick={() => void thread.query.refetch()}
        >
          {thread.query.isFetching ? "Retrying…" : `Retry ${name}`}
        </button>
      </div>
    );
  }
  if (thread.query.data === undefined) {
    return (
      <p className={styles.message} role="status">
        Loading {name}…
      </p>
    );
  }
  if (thread.query.data.items.length === 0) {
    return (
      <p className={styles.message}>
        {name === "comments" ? "No comments yet. Start the discussion." : "No replies yet."}
      </p>
    );
  }
  return null;
}

function MoreComments({
  thread,
  replies = false,
  onLoad,
}: {
  readonly thread: CommentThread;
  readonly replies?: boolean;
  readonly onLoad: () => void;
}) {
  if (!thread.hasMore) return null;
  return (
    <div className={styles.pagination}>
      {thread.pageError !== null ? (
        <p className={styles.error} role="status">
          Could not load more {replies ? "replies" : "comments"}. The loaded discussion is kept.
        </p>
      ) : null}
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={thread.loadingMore}
        onClick={onLoad}
      >
        {thread.loadingMore
          ? "Loading…"
          : thread.pageError !== null
            ? `Retry more ${replies ? "replies" : "comments"}`
            : replies
              ? "Load more replies"
              : "Load older comments"}
      </button>
    </div>
  );
}

function focusComment(comment: MarketComment | undefined) {
  if (comment === undefined) return;
  window.requestAnimationFrame(() => document.getElementById(`comment-${comment.id}`)?.focus());
}

function CommentRow({
  comment,
  account,
  onReplyPosted,
}: {
  readonly comment: MarketComment;
  readonly account: CommentIdentityState;
  readonly onReplyPosted: () => void;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [repliesOpened, setRepliesOpened] = useState(false);
  const [composing, setComposing] = useState(false);
  const [composerOpened, setComposerOpened] = useState(false);
  const replyButton = useRef<HTMLButtonElement>(null);
  const thread = useCommentThread(comment.marketId, comment.id, repliesOpened);

  function posted(reply: MarketComment) {
    thread.insert(reply);
    setExpanded(true);
    setRepliesOpened(true);
    onReplyPosted();
  }

  return (
    <li className={styles.row}>
      <article
        id={`comment-${comment.id}`}
        tabIndex={-1}
        aria-label={`Comment by ${formatForecasterName(comment.author)}`}
      >
        <CommentText comment={comment} />
        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            aria-expanded={expanded}
            aria-controls={`${id}-replies`}
            onClick={() => {
              setRepliesOpened(true);
              setExpanded((current) => !current);
            }}
          >
            {expanded ? "Hide" : "Show"} {comment.replyCount}{" "}
            {comment.replyCount === 1 ? "reply" : "replies"}
          </button>
          <button
            ref={replyButton}
            type="button"
            className={styles.secondaryButton}
            aria-expanded={composing}
            aria-controls={`${id}-composer`}
            onClick={() => {
              setComposerOpened(true);
              setComposing((current) => !current);
            }}
          >
            {composing ? "Hide draft" : "Reply"}
          </button>
        </div>
        <div id={`${id}-composer`} hidden={!composing} className={styles.replyComposer}>
          {composerOpened ? (
            <CommentComposer
              marketId={comment.marketId}
              parentId={comment.id}
              account={account}
              onPosted={posted}
              onCancel={() => {
                setComposing(false);
                replyButton.current?.focus();
              }}
            />
          ) : null}
        </div>
        <div id={`${id}-replies`} className={styles.replies} hidden={!expanded}>
          {expanded ? <ThreadState thread={thread} name="replies" /> : null}
          <ol
            className={styles.list}
            aria-label={`Replies to ${formatForecasterName(comment.author)}, oldest first`}
          >
            {thread.query.data?.items.map((reply) => (
              <li key={reply.id} className={styles.reply}>
                <article
                  id={`comment-${reply.id}`}
                  tabIndex={-1}
                  aria-label={`Reply by ${formatForecasterName(reply.author)}`}
                >
                  <CommentText comment={reply} />
                </article>
              </li>
            ))}
          </ol>
          <MoreComments
            thread={thread}
            replies
            onLoad={() => void thread.loadMore().then((items) => focusComment(items[0]))}
          />
        </div>
      </article>
    </li>
  );
}

export function MarketComments({ marketId }: { readonly marketId: string }) {
  const id = useId();
  const queryClient = useQueryClient();
  const thread = useCommentThread(marketId, null);
  const identityQuery = useQuery({
    queryKey: queryKeys.identity,
    queryFn: requestPortfolioIdentity,
  });
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string> | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (thread.query.data !== undefined && visibleIds === null) {
      setVisibleIds(new Set(thread.query.data.items.map((comment) => comment.id)));
    }
  }, [thread.query.data, visibleIds]);

  async function refreshIdentity(): Promise<CommentIdentity | null> {
    // ACCOUNT_CHANGED requires a new cookie-backed read, not a stale shared-cache
    // hit or an already-running request started before account selection.
    await queryClient.cancelQueries({ queryKey: queryKeys.identity, exact: true });
    const identity = await requestPortfolioIdentity();
    queryClient.setQueryData(queryKeys.identity, identity);
    return identity;
  }

  const accountMissing =
    identityQuery.error instanceof ApiClientError && identityQuery.error.code === "USER_REQUIRED";
  const account: CommentIdentityState = {
    identity: accountMissing ? null : (identityQuery.data ?? null),
    checking: identityQuery.isPending,
    unavailable: identityQuery.isError && !accountMissing,
    refresh: refreshIdentity,
  };
  const comments = thread.query.data?.items ?? [];
  const visible =
    visibleIds === null ? comments : comments.filter((comment) => visibleIds.has(comment.id));
  const staged =
    visibleIds === null ? [] : comments.filter((comment) => !visibleIds.has(comment.id));

  function include(items: readonly MarketComment[]) {
    setVisibleIds(
      (current) =>
        new Set([
          ...(current ?? comments.map((comment) => comment.id)),
          ...items.map((comment) => comment.id),
        ]),
    );
  }

  async function loadOlder() {
    const loaded = await thread.loadMore();
    include(loaded);
    if (loaded.length > 0) setAnnouncement(`${loaded.length} older comments loaded.`);
    focusComment(loaded[0]);
  }

  return (
    <section className={styles.module} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <h2 className={styles.tab} id={`${id}-title`}>
          Comments
        </h2>
        <p>Market-wide discussion · newest first</p>
      </header>
      <CommentComposer
        marketId={marketId}
        parentId={null}
        account={account}
        onPosted={(comment) => {
          include([comment]);
          thread.insert(comment);
        }}
      />
      {staged.length > 0 ? (
        <div className={styles.newComments}>
          <p role="status">New comments available ({staged.length}).</p>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              include(staged);
              setAnnouncement(`${staged.length} new comments shown.`);
              focusComment(staged[0]);
            }}
          >
            Show new comments
          </button>
        </div>
      ) : null}
      <ThreadState thread={thread} name="comments" />
      <ol className={styles.list} aria-label="Market comments, newest first">
        {visible.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            account={account}
            onReplyPosted={() => {
              void queryClient.invalidateQueries({
                queryKey: queryKeys.commentThread(marketId, null),
                exact: true,
              });
            }}
          />
        ))}
      </ol>
      <MoreComments thread={thread} onLoad={() => void loadOlder()} />
      <p className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
