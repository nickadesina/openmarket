import type { QuestionInput } from "../api/tournament-schemas.js";

/**
 * The launch question set. Dates are America/Los_Angeles 23:59 (PST, UTC−8);
 * `opens_at` is supplied at seed time ("at launch"). Rulebooks are pinned
 * when a question opens and never change afterwards.
 */
const RESTATEMENT_RULE =
  "Disputes are accepted for 72 hours after resolution, as replies or DMs to the tournament's X account; the outcome is recorded on the question. A figure restated by the source after that window does not reopen the question.";

/** Distributes over the question union so each unit keeps its own fields. */
type LaunchQuestion = QuestionInput extends infer Q
  ? Q extends unknown
    ? Omit<Q, "opens_at">
    : never
  : never;

export const LAUNCH_QUESTIONS: readonly LaunchQuestion[] = [
  {
    slug: "anthropic-ipo-day1-mcap",
    title: "What will Anthropic's market cap be at the close of its first trading day?",
    unit: "USD_T",
    description_md: [
      "Anthropic's basic-shares market capitalization at the official close of its first day of trading, in USD trillions. The last bucket is the timing question folded in: no first trade by December 31, 2026.",
      "**Note to forecasters:** press “valued at” figures are fully diluted and typically run 5–15% above this basic-shares figure.",
    ].join("\n\n"),
    rulebook_md: [
      "**Figure:** the primary listing exchange's official closing price on Anthropic's first day of trading × shares of common stock (all classes) outstanding immediately after the offering as stated in the final prospectus (424(b)), excluding the over-allotment option and all options, RSUs and warrants. Basic, not fully diluted.",
      "Rounded to the nearest $0.01T.",
      "**Floor:** resolves if Anthropic's shares have not traded by 2026-12-31 23:59 America/Los_Angeles. The question closes then, or at the first trade if it comes first.",
      RESTATEMENT_RULE,
    ].join("\n\n"),
    rulebook_version: 1,
    closes_at: "2027-01-01T07:59:00Z",
    expiry_at: "2027-01-01T07:59:00Z",
    buckets: {
      edges: [1.25, 1.5, 1.75, 2.0, 2.3],
      // Edges print as typed by the engine (2, not 2.0); the labels keep one decimal.
      labels: [null, null, null, "1.75–2.0", "2.0–2.3", null],
      floor_label: "No first trade by Dec 31, 2026",
    },
  },
  {
    slug: "openai-round-vs-anthropic-ipo",
    title:
      "Which comes first: an OpenAI priced round at ≥$1.4T post-money, or Anthropic's first trade?",
    unit: "choice",
    description_md:
      "A race between a private print and a public one: OpenAI announcing a priced primary round at a post-money valuation of at least $1.4 trillion, or Anthropic's shares beginning to trade.",
    rulebook_md: [
      "**OpenAI first:** OpenAI announces a priced primary round at a post-money valuation of at least $1.4T. “Announces” means a company statement, or at least two of Reuters, Bloomberg, the Wall Street Journal, the Financial Times and The Information reporting a signed or closed round. A first close counts; “in talks” and commitments do not. A reported valuation whose basis is not stated is read as post-money.",
      "**Anthropic first:** the first trade print in Anthropic's shares on its primary listing exchange.",
      "Each event is dated by its public time: for OpenAI, the earlier of the company statement and the second qualifying report; for Anthropic, the first trade print. The earlier event wins.",
      "**Floor:** resolves if neither happens by 2026-12-31 23:59 America/Los_Angeles. The question closes then, or at the first of the two events.",
      RESTATEMENT_RULE,
    ].join("\n\n"),
    rulebook_version: 1,
    closes_at: "2027-01-01T07:59:00Z",
    expiry_at: "2027-01-01T07:59:00Z",
    outcomes: {
      labels: ["OpenAI first", "Anthropic first"],
      floor_label: "Neither by Dec 31, 2026",
    },
  },
];
