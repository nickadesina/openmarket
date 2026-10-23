import { TournamentBoard } from "../../components/tournament-board/tournament-board.js";
import { getRuntimeDatabase } from "../../lib/db/runtime.js";
import { listQuestions, type QuestionSummary } from "../../lib/services/tournament/get-question.js";
import styles from "./page.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadQuestions(): Promise<QuestionSummary[] | undefined> {
  try {
    return await listQuestions(getRuntimeDatabase());
  } catch {
    return undefined;
  }
}

// A failed X sign-in returns to /t/signin, which explains it (signInFailure).
export default async function TournamentIndex() {
  const questions = await loadQuestions();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Questions</h1>
        <p>
          Each question asks for one number: the chance of YES, or a dollar level. Revise it until
          the question closes. Your score is averaged over the open window, so early, steady
          accuracy counts most. Every forecast is public under your name.
        </p>
      </header>
      <TournamentBoard initialQuestions={questions} />
      <p className={styles.disclosure}>
        <strong className={styles.disclosureLead}>No money moves here.</strong> The tournament
        produces a ranking per prize period; prizes, if any, are handled off-platform.
      </p>
    </div>
  );
}
