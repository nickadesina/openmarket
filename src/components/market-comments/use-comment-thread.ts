"use client";

import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { apiRequest } from "../../lib/client/api.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { CommentPage, MarketComment } from "../../lib/services/list-comments.js";

const COMMENTS_POLL_MS = 20_000;

interface LoadedComments extends CommentPage {
  readonly overflow: readonly MarketComment[];
  readonly postedReplies: readonly MarketComment[];
}

export interface CommentThread {
  readonly query: UseQueryResult<LoadedComments, Error>;
  readonly loadingMore: boolean;
  readonly hasMore: boolean;
  readonly pageError: unknown;
  readonly loadMore: () => Promise<readonly MarketComment[]>;
  readonly insert: (comment: MarketComment) => void;
}

export function commentsPath(marketId: string, parentId: string | null, cursor: string | null) {
  const params = new URLSearchParams();
  if (parentId !== null) params.set("parentId", parentId);
  if (cursor !== null) params.set("cursor", cursor);
  const query = params.toString();
  return `/api/markets/by-id/${encodeURIComponent(marketId)}/comments${query ? `?${query}` : ""}`;
}

export function mergeComments(
  previous: readonly MarketComment[],
  incoming: readonly MarketComment[],
  parentId: string | null,
): MarketComment[] {
  const byId = new Map(previous.map((comment) => [comment.id, comment]));
  for (const comment of incoming) byId.set(comment.id, comment);
  return Array.from(byId.values()).sort((left, right) => {
    const order = left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
    return parentId === null ? -order : order;
  });
}

export function useCommentThread(
  marketId: string,
  parentId: string | null,
  enabled = true,
): CommentThread {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.commentThread(marketId, parentId);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<unknown>(null);
  const loadingMoreRef = useRef(false);

  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<LoadedComments> => {
      const previous = queryClient.getQueryData<LoadedComments>(queryKey);
      const boundary = previous?.items.at(-1)?.id;
      let page = await apiRequest<CommentPage>(commentsPath(marketId, parentId, null), { signal });
      const items = [...page.items];
      // Poll through the oldest loaded root (or newest loaded reply). Reusing fixed
      // page cursors would leave gaps when new roots push old rows off the first page,
      // allowing a loaded removed body to escape future refreshes.
      while (
        boundary !== undefined &&
        page.nextCursor !== null &&
        !page.items.some((comment) => comment.id === boundary)
      ) {
        page = await apiRequest<CommentPage>(commentsPath(marketId, parentId, page.nextCursor), {
          signal,
        });
        items.push(...page.items);
      }
      const boundaryIndex = items.findIndex((comment) => comment.id === boundary);
      // A shifted final page may also contain older rows the reader never loaded.
      // Buffer those behind Load more rather than treating them as new roots or
      // quietly growing the visible history on every poll.
      const overflow = boundaryIndex < 0 ? [] : items.splice(boundaryIndex + 1);
      const postedReplies = (previous?.postedReplies ?? [])
        .filter((reply) => !items.some((comment) => comment.id === reply.id))
        .map((reply) => overflow.find((comment) => comment.id === reply.id) ?? reply);
      return { items, nextCursor: page.nextCursor, overflow, postedReplies };
    },
    // A newly posted reply can be far beyond the pages the reader loaded. Display
    // it without making it the pagination boundary and fetching every intervening
    // page on the next poll. Fetched copies replace these local confirmations.
    select: (data) =>
      data.postedReplies.length === 0
        ? data
        : {
            ...data,
            items: mergeComments(data.items, data.postedReplies, parentId),
          },
    enabled: enabled && !loadingMore,
    refetchInterval: COMMENTS_POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: COMMENTS_POLL_MS,
    retry: false,
  });

  async function loadMore(): Promise<readonly MarketComment[]> {
    const previous = queryClient.getQueryData<LoadedComments>(queryKey);
    if (
      previous === undefined ||
      (previous.nextCursor === null && previous.overflow.length === 0) ||
      loadingMoreRef.current
    )
      return [];
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setPageError(null);
    try {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const page =
        previous.overflow.length > 0
          ? { items: previous.overflow, nextCursor: previous.nextCursor }
          : await apiRequest<CommentPage>(commentsPath(marketId, parentId, previous.nextCursor));
      queryClient.setQueryData<LoadedComments>(queryKey, (current) => ({
        items: mergeComments(current?.items ?? [], page.items, parentId),
        nextCursor: page.nextCursor,
        overflow: [],
        postedReplies: (current?.postedReplies ?? []).filter(
          (reply) => !page.items.some((comment) => comment.id === reply.id),
        ),
      }));
      return page.items;
    } catch (error) {
      setPageError(error);
      return [];
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  function insert(comment: MarketComment) {
    // Cancel stale reads before publishing the authoritative POST result to the cache.
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<LoadedComments>(queryKey, (current) => ({
      items:
        parentId === null
          ? mergeComments(current?.items ?? [], [comment], parentId)
          : (current?.items ?? []),
      nextCursor: current?.nextCursor ?? null,
      overflow: current?.overflow ?? [],
      postedReplies:
        parentId === null ? [] : mergeComments(current?.postedReplies ?? [], [comment], parentId),
    }));
    void queryClient.invalidateQueries({ queryKey, exact: true });
  }

  const hasMore =
    query.data !== undefined && (query.data.nextCursor !== null || query.data.overflow.length > 0);
  return { query, loadingMore, hasMore, pageError, loadMore, insert };
}
