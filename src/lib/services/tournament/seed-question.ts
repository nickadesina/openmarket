import type { Kysely } from "kysely";

import type { QuestionInput } from "../../api/tournament-schemas.js";
import type { Database } from "../../db/schema.js";
import { openQuestionIn, saveDraftQuestionIn } from "./admin.js";

/** Saves a launch question and optionally opens it. */
export async function seedQuestion(
  db: Kysely<Database>,
  input: QuestionInput,
  open: boolean,
): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    await saveDraftQuestionIn(transaction, input);
    if (open) await openQuestionIn(transaction, input.slug);
  });
}
