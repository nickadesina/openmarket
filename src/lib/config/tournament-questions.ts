import type { QuestionInput } from "../api/tournament-schemas.js";

/**
 * The launch question set. Dates are America/Los_Angeles 23:59 (PST, UTC−8);
 * `opens_at` is supplied at seed time ("at launch"). Rulebooks are pinned
 * when a question opens and never change afterwards.
 */
const RESTATEMENT_RULE =
  "Disputes are accepted for 72 hours after resolution, as replies or DMs to the tournament's X account; the outcome is recorded on the question. A figure restated by the source after that window does not reopen the question.";

/** Distributes over the numeric/binary union so each keeps its own fields. */
type LaunchQuestion = QuestionInput extends infer Q
  ? Q extends unknown
    ? Omit<Q, "opens_at">
    : never
  : never;

export const LAUNCH_QUESTIONS: readonly LaunchQuestion[] = [
  {
    slug: "anthropic-s1-by-nov30",
    title: "Will Anthropic publicly file a Form S-1 by November 30, 2026?",
    unit: "bool",
    description_md:
      "Whether Anthropic, PBC has a Form S-1 publicly available on SEC EDGAR with a filing date on or before November 30, 2026.",
    rulebook_md: [
      "Resolves **Yes** if a Form S-1 filed by Anthropic, PBC (not a DRS, not an S-1/A) is publicly available on SEC EDGAR with a filing date on or before 2026-11-30; otherwise **No**.",
      "The question closes 2026-11-30 23:59 America/Los_Angeles.",
      RESTATEMENT_RULE,
    ].join("\n\n"),
    rulebook_version: 1,
    closes_at: "2026-12-01T07:59:00Z",
  },
  {
    slug: "anthropic-s1-arr",
    title: "What ARR will Anthropic's first S-1 report?",
    unit: "USD_B",
    description_md:
      "The annualized revenue run-rate Anthropic, PBC discloses in its first public Form S-1, in USD billions, by the figure hierarchy in the rulebook.",
    rulebook_md: [
      "**Resolution document:** the first Form S-1 filed by Anthropic, PBC on EDGAR (not the confidential draft, not an S-1/A, not a 424(b)).",
      "**Figure**, first rung that applies:",
      [
        "1. A number the filing labels annualized revenue run-rate, ARR, or equivalent. The most recent as-of date if several; “more than $X” resolves to X; a range resolves to its midpoint.",
        "2. Most recent completed fiscal quarter revenue × 4.",
        "3. Trailing-twelve-month revenue.",
      ].join("\n"),
      "The rung that fired is recorded. Rounded to the nearest $0.1B.",
      "**Floor:** resolves if no such filing exists by 2026-12-31 23:59 America/Los_Angeles. The question closes then, or at the S-1's public timestamp if it appears first.",
      RESTATEMENT_RULE,
    ].join("\n\n"),
    rulebook_version: 1,
    closes_at: "2027-01-01T07:59:00Z",
    expiry_at: "2027-01-01T07:59:00Z",
    buckets: {
      edges: [66, 70, 74, 78, 83, 88, 94],
      floor_label: "No public S-1 on EDGAR by Dec 31, 2026",
    },
  },
  {
    slug: "anthropic-ipo-day1-mcap",
    title: "What will Anthropic's market cap be at the close of its first trading day?",
    unit: "USD_T",
    description_md: [
      "Anthropic's basic-shares market capitalization at the Nasdaq official close on its first day of trading, in USD trillions.",
      "**Note to forecasters:** press “valued at” figures are fully diluted and typically run 5–15% above this basic-shares figure.",
    ].join("\n\n"),
    rulebook_md: [
      "**Figure:** Nasdaq official closing price on Anthropic's first day of trading × shares of common stock (all classes) outstanding immediately after the offering as stated in the final prospectus (424(b)(4)), excluding the over-allotment option and all options, RSUs and warrants.",
      "Rounded to the nearest $0.01T.",
      "**Floor:** resolves if no first trading day occurs by 2027-01-31 23:59 America/Los_Angeles. The question closes then, or at the first trade if it comes first.",
      RESTATEMENT_RULE,
    ].join("\n\n"),
    rulebook_version: 1,
    closes_at: "2027-02-01T07:59:00Z",
    expiry_at: "2027-02-01T07:59:00Z",
    buckets: {
      edges: [0.8, 0.95, 1.1, 1.3, 1.5, 1.75, 2.0, 2.4, 2.8],
      floor_label: "No first trading day by Jan 31, 2027",
    },
  },
];
