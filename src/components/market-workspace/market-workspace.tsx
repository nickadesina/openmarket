"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { DistributionChart } from "../distribution-chart/distribution-chart.js";
import { MarketActivity } from "../market-activity/market-activity.js";
import { MarketChart } from "../market-chart/market-chart.js";
import { MarketHeader } from "../market-header/market-header.js";
import { StrikeLadder } from "../strike-ladder/strike-ladder.js";
import { TradeTicket } from "../trade-ticket/trade-ticket.js";
import styles from "./market-workspace.module.css";
import type { ActivityPage, MarketDetail, MarkHistory, MarkRange, TradeSelection } from "./types.js";

interface MarketWorkspaceProps {
  readonly slug: string;
  readonly initialMarket: MarketDetail | null;
  readonly initialMarks: MarkHistory | null;
}

const POLL_INTERVAL_MS = 4_000;
const FLASH_DURATION_MS = 220;
const MOBILE_QUERY = "(max-width: 52rem)";

export function MarketWorkspace({ slug, initialMarket, initialMarks }: MarketWorkspaceProps) {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<MarkRange>(initialMarks?.range ?? "1d");
  const [selection, setSelection] = useState<TradeSelection | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [movement, setMovement] = useState<"up" | "down" | "flat">("flat");
  const previousMetric = useRef(initialMarket?.metric.current);

  const marketQuery = useQuery({
    queryKey: queryKeys.market(slug),
    queryFn: () => apiRequest<MarketDetail>(`/api/markets/${encodeURIComponent(slug)}`),
    initialData: initialMarket ?? undefined,
    refetchInterval: POLL_INTERVAL_MS,
  });
  const marksQuery = useQuery({
    queryKey: queryKeys.marks(slug, range),
    queryFn: () => apiRequest<MarkHistory>(`/api/markets/${encodeURIComponent(slug)}/marks?range=${range}`),
    initialData: initialMarks?.range === range ? initialMarks : undefined,
    refetchInterval: POLL_INTERVAL_MS,
  });
  const activityQuery = useQuery({
    queryKey: queryKeys.activity(slug),
    queryFn: () => apiRequest<ActivityPage>(`/api/activity?slug=${encodeURIComponent(slug)}&limit=25`),
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

  useEffect(() => {
    const current = marketQuery.data?.metric.current;
    if (current === undefined) return;
    const previous = previousMetric.current;
    previousMetric.current = current;
    if (previous === undefined || current === previous) return;
    setMovement(current > previous ? "up" : "down");
    const timer = window.setTimeout(() => setMovement("flat"), FLASH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [marketQuery.data?.metric.current]);

  useEffect(() => {
    if (marketQuery.data?.status === "settled") setSheetOpen(false);
  }, [marketQuery.data?.status]);

  const refreshAuthoritativeData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.market(slug) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.marks(slug, range) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(slug) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio }),
      queryClient.invalidateQueries({ queryKey: queryKeys.markets }),
    ]);
    await Promise.all([
      queryClient.refetchQueries({ queryKey: queryKeys.market(slug), type: "all" }),
      queryClient.refetchQueries({ queryKey: queryKeys.marks(slug, range), type: "all" }),
      queryClient.refetchQueries({ queryKey: queryKeys.activity(slug), type: "all" }),
      queryClient.refetchQueries({ queryKey: queryKeys.portfolio, type: "all" }),
    ]);
  }, [queryClient, range, slug]);

  if (marketQuery.data === undefined) {
    const marketNotFound = marketQuery.error instanceof ApiClientError
      && marketQuery.error.code === "MARKET_NOT_FOUND";
    return (
      <div className={styles.page}>
        {marketQuery.isError ? (
          <div className={styles.pageState} role="alert">
            <strong>{marketNotFound ? "Market not found" : "Market temporarily unavailable"}</strong>
            <p>
              {marketNotFound
                ? "No market matches this address."
                : "Market data is temporarily unavailable. Try again in a moment."}
            </p>
            <button type="button" onClick={() => void marketQuery.refetch()}>Retry market</button>
          </div>
        ) : (
          <div className={styles.loadingState} role="status" aria-busy="true" aria-label="Loading market workspace">
            <span /><span /><span />
          </div>
        )}
      </div>
    );
  }

  const market = marketQuery.data;
  const selectContract = (nextSelection: TradeSelection) => {
    setSelection(nextSelection);
    if (window.matchMedia(MOBILE_QUERY).matches) setSheetOpen(true);
  };

  const desktopTicket = selection !== null && market.status === "open"
    ? (
        <TradeTicket
          key={`desktop-${selection.strikeIndex}-${selection.side}`}
          market={market}
          selection={selection}
          onAuthoritativeRefresh={refreshAuthoritativeData}
        />
      )
    : null;
  const mobileTicket = selection !== null && market.status === "open"
    ? (
        <TradeTicket
          key={`mobile-${selection.strikeIndex}-${selection.side}`}
          market={market}
          selection={selection}
          onAuthoritativeRefresh={refreshAuthoritativeData}
          onClose={() => setSheetOpen(false)}
        />
      )
    : null;

  return (
    <div className={styles.page}>
      <MarketHeader market={market} movement={movement} />
      {marketQuery.isError ? (
        <div className={styles.staleNotice} role="status">
          Live refresh paused. Displaying the latest confirmed market state.
          <button type="button" onClick={() => void marketQuery.refetch()}>Retry</button>
        </div>
      ) : null}

      <div className={styles.workspace}>
        <div className={styles.mainRegion}>
          <MarketChart
            market={market}
            marks={marksQuery.data}
            range={range}
            loading={marksQuery.isLoading}
            error={marksQuery.isError}
            onRangeChange={setRange}
            onRetry={() => void marksQuery.refetch()}
          />
          <StrikeLadder market={market} selection={selection} onSelect={selectContract} />
        </div>

        {market.status === "open" ? (
          <aside className={styles.tradeRail} aria-label="Trade rail">
            {desktopTicket ?? (
              <div className={styles.ticketPrompt}>
                <strong>Select a probability</strong>
                <p>Choose YES or NO in the ladder to prepare a live quote.</p>
              </div>
            )}
          </aside>
        ) : null}
      </div>

      <DistributionChart market={market} />
      <MarketActivity
        market={market}
        activity={activityQuery.data}
        loading={activityQuery.isLoading || activityQuery.isFetching}
        error={activityQuery.isError}
        onRetry={() => void activityQuery.refetch()}
      />

      {market.status === "open" ? (
        <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className={styles.sheetOverlay} />
            <Dialog.Content className={styles.sheetContent} aria-describedby="trade-sheet-description">
              <Dialog.Title className={styles.visuallyHidden}>Trade {market.company.name}</Dialog.Title>
              <Dialog.Description id="trade-sheet-description" className={styles.visuallyHidden}>
                Review a quote and confirm a paper-money trade.
              </Dialog.Description>
              {mobileTicket}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}
