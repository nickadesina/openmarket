/**
 * Writes a proposer's question file (docs/tradeables/questions/<proposer>.json)
 * for `seed:tournament -- --from=<file>`: each listed name's binary and
 * forward, expiring at one quarter-end, worded from the rulebook the way the
 * dealer's linked questions are (decision 0004), and resolved by an admin.
 *
 *   npm run export:proposer-questions -- --proposer=futuresearch --by=2027-03-31
 *
 * `proposed_by` is written null: fill it once the proposer agrees to be named.
 * A forward is asked in USD trillions when the name's last print is $1T or
 * more, else billions (the dealer reads its listing mid; there is none here).
 */
import { readFileSync, writeFileSync } from "node:fs";

import params from "../backtest/out/params.json";
import type { QuestionInput } from "../src/lib/api/tournament-schemas.js";
import {
  EVENTS_CSV_PATH,
  listingAnchors,
  SOURCES_CSV_PATH,
} from "../src/lib/config/listing-anchors.js";
import { quarterEndCutoff } from "../src/lib/engine/dealer/rulebook.js";
import { instrumentQuestion } from "../src/lib/services/dealer/list-instruments.js";
import { PUBLIC_S1_COMPANIES } from "../src/lib/services/dealer/seed-listings.js";
import {
  binaryRulebook,
  forwardQuestionUnit,
  forwardRulebook,
  questionRulebookVersion,
  unitWords,
} from "../src/lib/services/dealer/tournament-bridge.js";
import { parseProposedQuestions } from "../src/lib/tradeables/proposed-questions.js";

const RESOLVED_BY = "An OpenMarket admin resolves this question under it.";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const proposer = argument("proposer");
const by = argument("by");
if (proposer === undefined || !/^[a-z0-9-]+$/.test(proposer)) {
  throw new Error("--proposer=<lowercase-name> is required");
}
if (by === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(by))
  throw new Error("--by=YYYY-MM-DD is required");
const expiry = quarterEndCutoff(new Date(`${by}T00:00:00Z`));
if (expiry.toISOString().slice(0, 10) !== by)
  throw new Error(`--by must be a quarter-end, not ${by}`);
const expiresAt = expiry.toISOString();

const names = Object.keys(params.forward_t_days);
const anchors = listingAnchors(
  readFileSync(EVENTS_CSV_PATH, "utf8"),
  readFileSync(SOURCES_CSV_PATH, "utf8"),
  names,
);
/** Distributes over the question union so each kind keeps its own fields. */
type FileQuestion = QuestionInput extends infer Q
  ? Q extends unknown
    ? Omit<Q, "opens_at" | "proposed_by"> & { readonly proposed_by: null }
    : never
  : never;
const questions: FileQuestion[] = [];
for (const anchor of anchors) {
  const name = anchor.company;
  const slug = name.toLowerCase().replaceAll(" ", "-");
  const listing = {
    binary_event: PUBLIC_S1_COMPANIES.has(name)
      ? ("public_s1" as const)
      : ("priced_round" as const),
  };
  const common = {
    rulebook_version: questionRulebookVersion(),
    closes_at: expiresAt,
    proposed_by: null,
  };
  questions.push({
    ...common,
    slug: `${slug}-${listing.binary_event === "public_s1" ? "s1" : "round"}-by-${by}`,
    title: instrumentQuestion(listing, name, "binary", expiry),
    kind: "binary",
    description_md: `${name}'s quarterly binary as OpenMarket's rulebook defines it, asked as a forecasting question that closes ${by}.`,
    rulebook_md: binaryRulebook(listing, RESOLVED_BY),
  });
  const unit = forwardQuestionUnit(Number(anchor.postMoneyUsd));
  questions.push({
    ...common,
    slug: `${slug}-next-print-by-${by}`,
    title: instrumentQuestion(listing, name, "forward", expiry),
    kind: "forward",
    unit,
    level_label: "Next post-money",
    expiry_at: expiresAt,
    description_md: `${name}'s next post-money in ${unitWords(unit)}, if a print comes by ${by}. With no print by then the question voids and nothing is scored. The last print was ${anchor.roundName} on ${anchor.announcementDate}.`,
    rulebook_md: forwardRulebook(unit, RESOLVED_BY),
  });
}

const text = `${JSON.stringify(questions, null, 2)}\n`;
parseProposedQuestions(text, new Date().toISOString());
const output = `docs/tradeables/questions/${proposer}.json`;
writeFileSync(output, text);
console.log(`wrote ${output} (${questions.length} questions)`);
