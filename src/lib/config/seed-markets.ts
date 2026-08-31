import type { SeedInput } from "../api/schemas.js";

/**
 * DEVELOPMENT DRAFTS ONLY — NOT PRODUCTION CONFIGURATION.
 *
 * The anchor values, dates, descriptions, and logo assets below have not been
 * source-verified. Verify each against current public reporting, record the
 * authoritative source, and replace this configuration before deployment.
 */
export const DEVELOPMENT_DRAFT_SEED_MARKETS = [
  {
    name: "Stripe",
    slug: "stripe",
    logo_path: "/logos/stripe.svg",
    metric_kind: "valuation_median",
    anchor_valuation_usd: "65000000000.00",
    anchor_date: "2024-02-28",
    anchor_description:
      "DEVELOPMENT DRAFT — not source-verified; verify Stripe's current public valuation, date, description, and source before deployment.",
    b: 15_000,
    sigma: 0.5,
  },
  {
    name: "Anthropic",
    slug: "anthropic",
    logo_path: "/logos/anthropic.svg",
    metric_kind: "valuation_median",
    anchor_valuation_usd: "61500000000.00",
    anchor_date: "2025-03-03",
    anchor_description:
      "DEVELOPMENT DRAFT — not source-verified; verify Anthropic's current public valuation, date, description, and source before deployment.",
    b: 25_000,
    sigma: 0.5,
  },
] as const satisfies readonly SeedInput[];
