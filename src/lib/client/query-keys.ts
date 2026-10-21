import type { MarkRange } from "../services/get-marks.js";

export const queryKeys = {
  all: ["openmarket"] as const,
  markets: ["openmarket", "markets"] as const,
  market: (slug: string) => ["openmarket", "market", slug] as const,
  marks: (slug: string, range: MarkRange) =>
    ["openmarket", "market", slug, "marks", range] as const,
  activity: (slug?: string) => ["openmarket", "activity", slug ?? "global"] as const,
  comments: (marketId: string) => ["openmarket", "comments", marketId] as const,
  commentThread: (marketId: string, parentId: string | null) =>
    ["openmarket", "comments", marketId, parentId ?? "roots"] as const,
  portfolio: ["openmarket", "portfolio"] as const,
  tournamentViewer: ["openmarket", "tournament", "me"] as const,
  tournamentQuestions: ["openmarket", "tournament", "questions"] as const,
  tournamentQuestion: (slug: string) => ["openmarket", "tournament", "question", slug] as const,
  tournamentForecasts: (slug: string) =>
    ["openmarket", "tournament", "question", slug, "forecasts"] as const,
  tournamentLeaderboard: (period: string) =>
    ["openmarket", "tournament", "leaderboard", period] as const,
  tournamentForecaster: (handle: string) =>
    ["openmarket", "tournament", "forecaster", handle.toLowerCase()] as const,
  tournamentDerived: ["openmarket", "tournament", "derived"] as const,
  tournamentAdmin: ["openmarket", "tournament", "admin"] as const,
  tournamentProvenance: (eventId: string) =>
    ["openmarket", "tournament", "provenance", eventId] as const,
} as const;
