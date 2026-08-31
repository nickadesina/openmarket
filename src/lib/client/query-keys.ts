export type MarkRange = "1h" | "1d" | "1w" | "all";

export const queryKeys = {
  all: ["openmarket"] as const,
  markets: ["openmarket", "markets"] as const,
  market: (slug: string) => ["openmarket", "market", slug] as const,
  marks: (slug: string, range: MarkRange) =>
    ["openmarket", "market", slug, "marks", range] as const,
  activity: (slug?: string) =>
    ["openmarket", "activity", slug ?? "global"] as const,
  portfolio: ["openmarket", "portfolio"] as const,
} as const;
