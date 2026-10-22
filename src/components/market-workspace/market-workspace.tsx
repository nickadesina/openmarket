"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError, apiRequest, POLL_INTERVAL_MS } from "../../lib/client/api.js";
import { formatPrice, formatProbability } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { forecasterHref, useTournamentViewer } from "../../lib/client/tournament.js";
import { DistributionChart } from "../distribution-chart/distribution-chart.js";
import { MarketActivity } from "../market-activity/market-activity.js";
import { MarketChart } from "../market-chart/market-chart.js";
import { MarketComments } from "../market-comments/market-comments.js";
import { MarketHeader } from "../market-header/market-header.js";
import { StrikeLadder } from "../strike-ladder/strike-ladder.js";
import { TradeTicket, workingContract } from "../trade-ticket/trade-ticket.js";
import styles from "./market-workspace.module.css";
import type {
  ActivityPage,
  ListingDetail,
  ListingView,
  MarkHistory,
  MarkRange,
  TradeSelection,
} from "./types.js";

interface MarketWorkspaceProps {
  readonly slug: string;
  readonly initialListing: ListingDetail | null;
  readonly initialMarks: MarkHistory | null;
  readonly initialActivity: ActivityPage | null;
}

const FLASH_DURATION_MS = 220;
const MOBILE_QUERY = "(max-width: 52rem)";

function defaultSelection(listing: ListingView): TradeSelection {
  return listing.forward === null && listing.binary !== null
    ? { contract: "binary", side: "yes" }
    : { contract: "forward", side: "long" };
}

/** The working contract's price: the side of the two-way quote a fill takes, or the binary side's. */
function workingPrice(listing: ListingView, selection: TradeSelection): string | null {
  if (selection.contract === "forward") {
    if (listing.forward === null) return null;
    return formatPrice(
      selection.side === "long" ? listing.forward.ask_usd : listing.forward.bid_usd,
    );
  }
  if (listing.binary === null) return null;
  return formatProbability(
    selection.side === "yes" ? listing.binary.yes_price : listing.binary.no_price,
  );
}

/**
 * The signed-in viewer's profile link when they attested a tie to this name
 * (README D12): the page then shows no ticket, and the server refuses the
 * trade regardless. Null otherwise.
 */
function useRestrictedProfile(companySlug: string): string | null {
  const viewer = useTournamentViewer().data?.viewer;
  if (viewer == null || !viewer.restrictedCompanySlugs.includes(companySlug)) return null;
  return forecasterHref(viewer.identity);
}

function hasLiveContract(listing: ListingView): boolean {
  return listing.forward !== null || listing.binary !== null;
}

/** The ticket, or in its place the one-line reason a restricted viewer has none. */
function TicketUnlessRestricted({
  name,
  profileHref,
  children,
}: {
  readonly name: string;
  readonly profileHref: string | null;
  readonly children: ReactNode;
}) {
  if (profileHref === null) return children;
  return (
    <div className={styles.ticketPrompt} role="note">
      <strong>Not open to you</strong>
      <p>
        You attested a tie to {name}, so its contracts are closed to you.{" "}
        <Link href={profileHref}>Change it on your profile.</Link>
      </p>
    </div>
  );
}

export function MarketWorkspace({
  slug,
  initialListing,
  initialMarks,
  initialActivity,
}: MarketWorkspaceProps) {
  const queryClient = useQueryClient();
  const restrictedProfile = useRestrictedProfile(slug);
  const [range, setRange] = useState<MarkRange>(initialMarks?.range ?? "1w");
  // The order form is live from first paint on the forward's long side.
  const [selection, setSelection] = useState<TradeSelection>(() =>
    initialListing === null
      ? { contract: "forward", side: "long" }
      : defaultSelection(initialListing),
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [movement, setMovement] = useState<"up" | "down" | "flat">("flat");
  const previousMid = useRef(initialListing?.forward?.mid_usd);

  const listingQuery = useQuery({
    queryKey: queryKeys.market(slug),
    queryFn: () => apiRequest<ListingDetail>(`/api/markets/${encodeURIComponent(slug)}`),
    initialData: initialListing ?? undefined,
    refetchInterval: POLL_INTERVAL_MS,
  });
  const listing = listingQuery.data;
  const chartMarketId = listing?.forward?.market_id ?? null;
  const marksQuery = useQuery({
    queryKey: queryKeys.marks(chartMarketId ?? "none", range),
    queryFn: () =>
      apiRequest<MarkHistory>(
        `/api/markets/by-id/${encodeURIComponent(chartMarketId!)}/marks?range=${range}`,
      ),
    enabled: chartMarketId !== null,
    initialData:
      initialMarks?.range === range && initialMarks.marketId === chartMarketId
        ? initialMarks
        : undefined,
    refetchInterval: POLL_INTERVAL_MS,
  });
  const activityQuery = useQuery({
    queryKey: queryKeys.activity(slug),
    queryFn: () =>
      apiRequest<ActivityPage>(`/api/activity?slug=${encodeURIComponent(slug)}&limit=25`),
    initialData: initialActivity ?? undefined,
    refetchInterval: POLL_INTERVAL_MS,
  });

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const closeSheetOnDesktop = (event: MediaQueryListEvent) => {
      if (!event.matches) setSheetOpen(false);
    };
    media.addEventListener("change", closeSheetOnDesktop);
    return () => media.removeEventListener("change", closeSheetOnDesktop);
  }, []);

  const mid = listing?.forward?.mid_usd;
  useEffect(() => {
    if (mid === undefined) return;
    const previous = previousMid.current;
    previousMid.current = mid;
    if (previous === undefined || mid === previous) return;
    setMovement(mid > previous ? "up" : "down");
    const timer = window.setTimeout(() => setMovement("flat"), FLASH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [mid]);

  const refreshAuthoritativeData = useCallback(async () => {
    const refetchOptions = { throwOnError: true };
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.market(slug) }, refetchOptions),
      queryClient.invalidateQueries({ queryKey: ["openmarket", "book"] }, refetchOptions),
      queryClient.invalidateQueries({ queryKey: ["openmarket", "instrument"] }, refetchOptions),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(slug) }, refetchOptions),
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio }, refetchOptions),
      queryClient.invalidateQueries({ queryKey: queryKeys.markets }, refetchOptions),
    ]);
  }, [queryClient, slug]);

  if (listing === undefined) {
    const notFound =
      listingQuery.error instanceof ApiClientError &&
      listingQuery.error.code === "MARKET_NOT_FOUND";
    return (
      <div className={styles.page}>
        {listingQuery.isError ? (
          <div className={styles.pageState} role="alert">
            <strong>{notFound ? "Market not found" : "Market temporarily unavailable"}</strong>
            <p>
              {notFound
                ? "No listed name matches this address."
                : "Market data is temporarily unavailable. Try again in a moment."}
            </p>
            <button type="button" onClick={() => void listingQuery.refetch()}>
              Retry market
            </button>
          </div>
        ) : (
          <div
            className={styles.loadingState}
            role="status"
            aria-busy="true"
            aria-label="Loading market workspace"
          >
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
    );
  }

  const trading = restrictedProfile === null && hasLiveContract(listing);
  const commentsMarketId = listing.forward?.market_id ?? listing.binary?.market_id ?? null;
  const price = workingPrice(listing, selection);

  const ticket = (variant: "desktop" | "mobile") => (
    <TradeTicket
      listing={listing}
      selection={selection}
      onSelectionChange={setSelection}
      onAuthoritativeRefresh={refreshAuthoritativeData}
      {...(variant === "mobile" ? { onClose: () => setSheetOpen(false) } : {})}
    />
  );

  return (
    <div className={styles.page}>
      <MarketHeader listing={listing} movement={movement} />
      {listingQuery.isError ? (
        <div className={styles.staleNotice} role="status">
          Live refresh paused. Displaying the latest confirmed market state.
          <button type="button" onClick={() => void listingQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : null}

      <div className={styles.workspace}>
        <div className={styles.mainRegion}>
          {chartMarketId === null ? null : (
            <MarketChart
              label="Forward mid"
              marks={marksQuery.data}
              lastTradeAt={listing.lastTradeAt}
              range={range}
              loading={marksQuery.isLoading}
              error={marksQuery.isError}
              onRangeChange={setRange}
              onRetry={() => void marksQuery.refetch()}
            />
          )}
          {listing.distribution === null ? (
            <div className={styles.ticketPrompt}>
              <strong>No live forward</strong>
              <p>The implied ladder returns when the next forward lists.</p>
            </div>
          ) : (
            <>
              <StrikeLadder distribution={listing.distribution} />
              <DistributionChart distribution={listing.distribution} />
            </>
          )}
        </div>

        <aside className={styles.tradeRail} aria-label="Trade rail">
          <TicketUnlessRestricted name={listing.company.name} profileHref={restrictedProfile}>
            {ticket("desktop")}
          </TicketUnlessRestricted>
        </aside>
      </div>

      {commentsMarketId === null ? null : (
        <MarketComments key={commentsMarketId} marketId={commentsMarketId} />
      )}
      <MarketActivity
        listing={listing}
        activity={activityQuery.data}
        loading={activityQuery.isFetching}
        error={activityQuery.isError}
        onRetry={() => void activityQuery.refetch()}
      />

      {trading ? (
        <div className={styles.mobileTradeBar}>
          <span className={styles.mobileTradeSummary}>
            <span>{workingContract(listing, selection)}</span>
            <strong>{price ?? "Not trading"}</strong>
          </span>
          <button
            type="button"
            className={styles.mobileTradeButton}
            onClick={() => setSheetOpen(true)}
          >
            Trade
          </button>
        </div>
      ) : null}

      <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.sheetOverlay} />
          <Dialog.Content
            className={styles.sheetContent}
            aria-describedby="trade-sheet-description"
          >
            <Dialog.Title className={styles.visuallyHidden}>
              Trade {listing.company.name}
            </Dialog.Title>
            <Dialog.Description id="trade-sheet-description" className={styles.visuallyHidden}>
              Review the dealer's quote and confirm a paper-money trade.
            </Dialog.Description>
            {ticket("mobile")}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
