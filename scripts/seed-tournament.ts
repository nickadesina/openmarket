/**
 * Creates (or replaces, while still drafts) the tournament's launch
 * questions. Opening is a separate, explicit step:
 *
 *   npm run seed:tournament                         # drafts only
 *   npm run seed:tournament -- --open               # drafts, then open at now
 *   npm run seed:tournament -- --open --opens-at=2026-10-20T16:00:00Z
 *
 * A question that is already open is pinned and reported as such.
 */
import { questionInputSchema } from "../src/lib/api/tournament-schemas.js";
import { LAUNCH_QUESTIONS } from "../src/lib/config/tournament-questions.js";
import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { openQuestion, saveDraftQuestion } from "../src/lib/services/tournament/admin.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const open = process.argv.includes("--open");
  const opensAt = argument("opens-at") ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(opensAt))) throw new Error("--opens-at must be an ISO timestamp");

  const db = createDirectDatabase();
  try {
    for (const launch of LAUNCH_QUESTIONS) {
      const input = questionInputSchema.parse({ ...launch, opens_at: opensAt });
      const existing = await db
        .selectFrom("tournament_questions")
        .select("status")
        .where("slug", "=", input.slug)
        .executeTakeFirst();
      if (existing !== undefined && existing.status !== "draft") {
        console.log(`pinned: ${input.slug} is ${existing.status}; left unchanged`);
        continue;
      }
      await saveDraftQuestion(db, input);
      console.log(`draft: ${input.slug}`);
      if (open) {
        await openQuestion(db, input.slug);
        console.log(`open: ${input.slug} from ${opensAt}`);
      }
    }
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error("Tournament seed failed", error instanceof Error ? error.message : "");
  process.exitCode = 1;
}
