import { z } from "zod";

import params from "../../../backtest/out/params.json";
import { type QuestionInput, questionInputSchema } from "../api/tournament-schemas.js";

/**
 * A proposer's question file (docs/tradeables/questions/<proposer>.json,
 * docs/prompts/tradeables item 7): a JSON array of the admin route's question
 * inputs without `opens_at`, which `seed:tournament -- --from=<file>` supplies
 * at seed time as it does for the launch set. Decision 0004 holds: each entry
 * is a binary or a forward (questionInputSchema refuses any other kind), on a
 * listed name (its slug starts with the name's slug). A proposer cannot
 * change either.
 */

/** The listed names' slugs, as seed:listings makes them from params.json. */
export const LISTED_SLUGS: readonly string[] = Object.keys(params.forward_t_days).map((name) =>
  name.toLowerCase().replaceAll(" ", "-"),
);

const entrySchema = z
  .looseObject({})
  .refine((entry) => !("opens_at" in entry), "opens_at is set at seed time, not in the file");

export function parseProposedQuestions(text: string, opensAt: string): QuestionInput[] {
  const entries = z.array(entrySchema).min(1).parse(JSON.parse(text));
  const questions = entries.map((entry, index) => {
    const parsed = questionInputSchema.safeParse({ ...entry, opens_at: opensAt });
    if (!parsed.success) {
      throw new Error(`question ${index + 1}: ${z.prettifyError(parsed.error)}`);
    }
    const question = parsed.data;
    if (!LISTED_SLUGS.some((slug) => question.slug.startsWith(`${slug}-`))) {
      throw new Error(
        `question ${index + 1} (${question.slug}): the slug must start with a listed name (${LISTED_SLUGS.join(", ")})`,
      );
    }
    return question;
  });
  const slugs = questions.map((question) => question.slug);
  const repeated = slugs.find((slug, index) => slugs.indexOf(slug) !== index);
  if (repeated !== undefined) throw new Error(`slug ${repeated} appears twice`);
  return questions;
}
