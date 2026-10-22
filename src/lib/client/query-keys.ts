import type { MarkRange } from "../services/get-marks.js";

export const queryKeys = {
  all: ["openmarket"] as const,
  markets: ["openmarket", "markets"] as const,
  market: (slug: string) => ["openmarket", "market", slug] as const,
  marks: (marketId: string, range: MarkRange) =>
    ["openmarket", "book", marketId, "marks", range] as const,
  instrumentQuote: (instrumentId: string, side: string, notionalUsd: string | null) =>
    ["openmarket", "instrument", instrumentId, "quote", side, notionalUsd ?? "none"] as const,
  activity: (slug?: string) => ["openmarket", "activity", slug ?? "global"] as const,
  comments: (marketId: string) => ["openmarket", "comments", marketId] as const,
  commentThread: (marketId: string, parentId: string | null) =>
    ["openmarket", "comments", marketId, parentId ?? "roots"] as const,
  identity: ["openmarket", "identity"] as const,
  portfolio: ["openmarket", "portfolio"] as const,
  tournamentViewer: ["openmarket", "tournament", "me"] as const,
  tournamentRestrictions: ["openmarket", "tournament", "me", "restrictions"] as const,
  tournamentQuestions: ["openmarket", "tournament", "questions"] as const,
  tournamentQuestion: (slug: string) => ["openmarket", "tournament", "question", slug] as const,
  tournamentForecasts: (slug: string) =>
    ["openmarket", "tournament", "question", slug, "forecasts"] as const,
  tournamentAggregateHistory: (slug: string) =>
    ["openmarket", "tournament", "question", slug, "aggregate-history"] as const,
  tournamentLeaderboard: (period: string) =>
    ["openmarket", "tournament", "leaderboard", period] as const,
  tournamentForecaster: (handle: string) =>
    ["openmarket", "tournament", "forecaster", handle.toLowerCase()] as const,
  tournamentAdmin: ["openmarket", "tournament", "admin"] as const,
  tournamentProvenance: (eventId: string) =>
    ["openmarket", "tournament", "provenance", eventId] as const,
  adminDealer: ["openmarket", "admin", "dealer"] as const,
} as const;
