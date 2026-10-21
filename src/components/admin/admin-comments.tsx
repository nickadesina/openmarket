"use client";

import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import { errorMessage, formatDateTime, formatForecasterName } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { CommentPage, MarketComment } from "../../lib/services/list-comments.js";
import type { MarketListResult } from "../../lib/services/list-markets.js";
import styles from "./admin-page.module.css";

interface ModerationProps {
  readonly marketId: string;
  readonly parentId?: string;
  readonly onAdminRequired: () => void;
}

const adminCommentsKey = (marketId: string, parentId?: string) =>
  ["openmarket", "comments", marketId, "admin", parentId ?? null] as const;

function ModerationComment({
  comment,
  onAdminRequired,
}: {
  readonly comment: MarketComment;
  readonly onAdminRequired: () => void;
}) {
  const queryClient = useQueryClient();
  const [repliesExpanded, setRepliesExpanded] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const author = formatForecasterName(comment.author);
  const removeMutation = useMutation({
    mutationFn: () =>
      apiRequest<MarketComment>(`/api/admin/comments/${comment.id}/remove`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    retry: false,
    onSuccess: async (removedComment) => {
      const queryKey = adminCommentsKey(comment.marketId, comment.parentId ?? undefined);
      await queryClient.cancelQueries({ queryKey, exact: true });
      if (articleRef.current?.contains(document.activeElement)) {
        articleRef.current.focus();
      }
      queryClient.setQueryData<InfiniteData<CommentPage, string | null>>(queryKey, (current) =>
        current === undefined
          ? current
          : {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                items: page.items.map((item) =>
                  item.id === removedComment.id ? removedComment : item,
                ),
              })),
            },
      );
      await queryClient.invalidateQueries({
        queryKey: ["openmarket", "comments", comment.marketId],
      });
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.code === "ADMIN_REQUIRED") {
        onAdminRequired();
      }
    },
  });

  function removeComment(): void {
    if (
      window.confirm(
        `Remove this comment by ${author}? Its replies will remain visible. This cannot be undone.`,
      )
    ) {
      removeMutation.mutate();
    }
  }

  return (
    <article className={styles.comment} ref={articleRef} tabIndex={-1}>
      <header className={styles.commentMeta}>
        <strong>{author}</strong>
        <time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time>
      </header>
      {comment.removedAt === null ? (
        <p className={styles.commentBody}>{comment.body}</p>
      ) : (
        <p className={styles.commentRemoved}>Comment removed.</p>
      )}
      <div className={styles.commentActions}>
        {comment.removedAt === null ? (
          <button
            type="button"
            className={styles.dangerButton}
            onClick={removeComment}
            disabled={removeMutation.isPending}
            aria-label={`Remove comment by ${author}`}
          >
            {removeMutation.isPending ? "Removing…" : "Remove comment"}
          </button>
        ) : null}
        {comment.parentId === null && comment.replyCount > 0 ? (
          <button
            type="button"
            className={styles.secondaryButton}
            aria-expanded={repliesExpanded}
            aria-controls={`admin-replies-${comment.id}`}
            onClick={() => setRepliesExpanded((expanded) => !expanded)}
          >
            {repliesExpanded ? "Hide" : "Show"} {comment.replyCount}{" "}
            {comment.replyCount === 1 ? "reply" : "replies"}
          </button>
        ) : null}
      </div>
      {removeMutation.isError ? (
        <p className={styles.inlineError} role="alert">
          {errorMessage(removeMutation.error, "The comment could not be removed.")}
        </p>
      ) : null}
      {comment.parentId === null && repliesExpanded ? (
        <div className={styles.commentReplies} id={`admin-replies-${comment.id}`}>
          <CommentList
            marketId={comment.marketId}
            parentId={comment.id}
            onAdminRequired={onAdminRequired}
          />
        </div>
      ) : null}
    </article>
  );
}

function CommentList({ marketId, parentId, onAdminRequired }: ModerationProps) {
  const commentsQuery = useInfiniteQuery({
    queryKey: adminCommentsKey(marketId, parentId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const parameters = new URLSearchParams();
      if (parentId !== undefined) parameters.set("parentId", parentId);
      if (pageParam !== null) parameters.set("cursor", pageParam);
      const query = parameters.toString();
      return apiRequest<CommentPage>(
        `/api/markets/by-id/${marketId}/comments${query === "" ? "" : `?${query}`}`,
        { signal },
      );
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const comments = commentsQuery.data?.pages.flatMap((page) => page.items);
  const isReplies = parentId !== undefined;

  return (
    <div className={styles.commentListPanel}>
      <p className={styles.commentHelp}>
        {isReplies ? "Replies, oldest first." : "Comments, newest first."}
      </p>
      {commentsQuery.isPending ? (
        <p role="status">Loading {isReplies ? "replies" : "comments"}…</p>
      ) : null}
      {commentsQuery.isError ? (
        <div>
          <p className={styles.inlineError} role="alert">
            {errorMessage(commentsQuery.error, "Comments could not be loaded.")}
          </p>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={commentsQuery.isFetching}
            onClick={() => {
              if (commentsQuery.isFetchNextPageError) {
                void commentsQuery.fetchNextPage();
              } else {
                void commentsQuery.refetch();
              }
            }}
          >
            Retry loading {isReplies ? "replies" : "comments"}
          </button>
        </div>
      ) : null}
      {comments?.length === 0 ? (
        <p className={styles.commentHelp}>
          {isReplies ? "No replies to this comment." : "No comments in this market."}
        </p>
      ) : null}
      {comments !== undefined && comments.length > 0 ? (
        <ol className={styles.commentList} aria-label={isReplies ? "Replies" : "Market comments"}>
          {comments.map((comment) => (
            <li key={comment.id}>
              <ModerationComment comment={comment} onAdminRequired={onAdminRequired} />
            </li>
          ))}
        </ol>
      ) : null}
      {commentsQuery.hasNextPage && !commentsQuery.isFetchNextPageError ? (
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={commentsQuery.isFetching}
          onClick={() => void commentsQuery.fetchNextPage()}
        >
          {commentsQuery.isFetchingNextPage
            ? "Loading…"
            : isReplies
              ? "Load more replies"
              : "Load older comments"}
        </button>
      ) : null}
    </div>
  );
}

export function AdminComments({ onAdminRequired }: { readonly onAdminRequired: () => void }) {
  const [marketId, setMarketId] = useState("");
  const marketsQuery = useQuery({
    queryKey: queryKeys.markets,
    queryFn: () => apiRequest<MarketListResult>("/api/markets"),
  });

  return (
    <section className={styles.operation} aria-labelledby="moderation-heading">
      <header className={styles.operationHeader}>
        <div>
          <p className={styles.sectionLabel}>Moderation</p>
          <h2 id="moderation-heading">Market comments</h2>
          <p>Remove comment content without removing its replies or place in the discussion.</p>
        </div>
      </header>
      <div className={styles.form}>
        <label className={styles.field} htmlFor="moderation-market">
          <span>Market</span>
          <select
            id="moderation-market"
            value={marketId}
            onChange={(event) => setMarketId(event.target.value)}
            disabled={marketsQuery.isPending}
          >
            <option value="">Choose a market</option>
            {marketsQuery.data?.markets.map((market) => (
              <option key={market.marketId} value={market.marketId}>
                {market.company.name} ({market.company.slug}) — {market.status}
              </option>
            ))}
          </select>
        </label>
        {marketsQuery.isPending ? <p role="status">Loading markets…</p> : null}
        {marketsQuery.isError ? (
          <div>
            <p className={styles.inlineError} role="alert">
              {errorMessage(marketsQuery.error, "Markets could not be loaded.")}
            </p>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void marketsQuery.refetch()}
              disabled={marketsQuery.isFetching}
            >
              Retry loading markets
            </button>
          </div>
        ) : null}
        {marketsQuery.data?.markets.length === 0 ? (
          <p className={styles.commentHelp}>No markets are available for moderation.</p>
        ) : null}
        {marketId !== "" ? (
          <CommentList key={marketId} marketId={marketId} onAdminRequired={onAdminRequired} />
        ) : null}
      </div>
    </section>
  );
}
