import type { QuestionInput } from "../api/tournament-schemas.js";

/**
 * The launch question set (decision 0004 → "The questions after the
 * change"): two forwards and two binaries. Dates are America/Los_Angeles
 * 23:59 (PST, UTC−8); `opens_at` is supplied at seed time ("at launch").
 * Rulebooks are pinned when a question opens and never change afterwards.
 * The two forwards replace the bucket questions once under these slugs
 * (voided and renamed `<slug>-v1` by migration 013), so their rulebooks are
 * version 2.
 */
const RESTATEMENT_RULE =
  "Disputes are accepted for 72 hours after resolution, as replies or DMs to the tournament's X account; the outcome is recorded on the question. A figure restated by the source after that window does not reopen the question.";

const ANTHROPIC_FIRST_TRADE =
  "the first trade print in Anthropic's shares on its primary listing exchange";

/** Distributes over the question union so each kind keeps its own fields. */
type LaunchQuestion = QuestionInput extends infer Q
  ? Q extends unknown
    ? Omit<Q, "opens_at">
    : never
  : never;

export const LAUNCH_QUESTIONS: readonly LaunchQuestion[] = [
  {
    slug: "anthropic-ipo-day1-mcap",
    title: "What will Anthropic's market cap be at the close of its first trading day?",
    kind: "forward",
    unit: "USD_T",
    level_label: "First-day market cap",
    description_md: [
      "Anthropic's basic-shares market capitalization at the official close of its first day of trading, in USD trillions. If Anthropic's shares have not traded by December 31, 2026, the question voids; the timing is its own question, anthropic-first-trade-by-2026.",
      "**Note to forecasters:** press “valued at” figures are fully diluted and typically run 5–15% above this basic-shares figure.",
    ].join("\n\n"),
    rulebook_md: [
      "**Figure:** the primary listing exchange's official closing price on Anthropic's first day of trading × shares of common stock (all classes) outstanding immediately after the offering as stated in the final prospectus (424(b)), excluding the over-allotment option and all options, RSUs and warrants. Basic, not fully diluted.",
      "Rounded to the nearest $0.01T.",
      "**Void:** if Anthropic's shares have not traded by 2026-12-31 23:59 America/Los_Angeles, the question voids and nothing is scored. The question closes then, or at the first trade if it comes first.",
      RESTATEMENT_RULE,
    ].join("\n\n"),
    rulebook_version: 2,
    closes_at: "2027-01-01T07:59:00Z",
    expiry_at: "2027-01-01T07:59:00Z",
  },
  {
    slug: "anthropic-424b-run-rate",
    title: "What annualized revenue run-rate will Anthropic's final IPO prospectus disclose?",
    kind: "forward",
    unit: "USD_B",
    level_label: "424(b) run-rate",
    description_md:
      "The annualized revenue run-rate Anthropic discloses in its final IPO prospectus (424(b)), in USD billions, as of the most recent date stated in that document. If the prospectus discloses no run-rate metric, or none is filed in time, the question voids.",
    rulebook_md: [
      "**Resolution document:** the final prospectus Anthropic files under Rule 424(b) on EDGAR in connection with its initial public offering. Earlier filings (the initial S-1 and any S-1/A) do not resolve the question; they are information.",
      "**Figure:** the number Anthropic itself labels “annualized revenue run-rate”, “run-rate revenue”, or an equivalent management-defined KPI in that document, at the most recent as-of date it states. If the prospectus gives several dates, the latest is used.",
      "A range (“approximately $X to $Y billion”) resolves to its midpoint; “over $X billion” resolves to X.",
      "**Void:** if no such KPI appears anywhere in the final prospectus, the question voids at its filing and nothing is scored. Quarterly or stub-period GAAP revenue multiplied by four does not count: a prospectus that prints only GAAP revenue voids the question. If no 424(b) is filed by 2027-01-31 23:59 America/Los_Angeles, the question voids and nothing is scored.",
      "The question closes at the 424(b)'s filing time, or 2027-01-31 23:59 America/Los_Angeles if none is filed first.",
      RESTATEMENT_RULE,
    ].join("\n\n"),
    rulebook_version: 2,
    closes_at: "2027-02-01T07:59:00Z",
    expiry_at: "2027-02-01T07:59:00Z",
  },
  {
    slug: "openai-round-before-anthropic-ipo",
    title:
      "Will OpenAI announce a priced round at ≥$1.4T post-money before Anthropic's first trade?",
    kind: "binary",
    description_md:
      "A race between a private print and a public one: OpenAI announcing a priced primary round at a post-money valuation of at least $1.4 trillion, before Anthropic's shares begin to trade.",
    rulebook_md: [
      "**YES:** OpenAI announces a priced primary round at a post-money valuation of at least $1.4T before Anthropic's first trade. “Announces” means a company statement, or at least two of Reuters, Bloomberg, the Wall Street Journal, the Financial Times and The Information reporting a signed or closed round. A first close counts; “in talks” and commitments do not. A reported valuation whose basis is not stated is read as post-money.",
      `**Anthropic's first trade:** ${ANTHROPIC_FIRST_TRADE}.`,
      "Each event is dated by its public time: for OpenAI, the earlier of the company statement and the second qualifying report; for Anthropic, the first trade print. The earlier event wins.",
      "**NO:** Anthropic's first trade comes first, or neither happens by 2026-12-31 23:59 America/Los_Angeles. The question closes then, or at the first of the two events.",
      RESTATEMENT_RULE,
    ].join("\n\n"),
    rulebook_version: 1,
    closes_at: "2027-01-01T07:59:00Z",
  },
  {
    slug: "anthropic-first-trade-by-2026",
    title: "Will Anthropic's shares trade by December 31, 2026?",
    kind: "binary",
    description_md:
      "The timing of Anthropic's listing: whether its shares begin trading by the end of 2026. The first-day market cap is its own question, anthropic-ipo-day1-mcap, which voids if they do not.",
    rulebook_md: [
      `**YES:** ${ANTHROPIC_FIRST_TRADE} comes by 2026-12-31 23:59 America/Los_Angeles.`,
      "**NO:** otherwise. The question closes then, or at the first trade if it comes first.",
      RESTATEMENT_RULE,
    ].join("\n\n"),
    rulebook_version: 1,
    closes_at: "2027-01-01T07:59:00Z",
  },
];
