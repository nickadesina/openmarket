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

interface TournamentIndexProps {
  readonly searchParams: Promise<{ readonly sign_in?: string }>;
}

export default async function TournamentIndex({ searchParams }: TournamentIndexProps) {
  const [{ sign_in: signIn }, questions] = await Promise.all([searchParams, loadQuestions()]);
  return (
    <div className={styles.page}>
      {signIn === "failed" || signIn === "unavailable" ? (
        <p className={styles.notice} role="alert">
          {signIn === "failed"
            ? "X sign-in did not complete. Try again; nothing was saved."
            : "X sign-in is not configured on this deployment."}
        </p>
      ) : null}
      <header className={styles.header}>
        <h1>Questions</h1>
        <p>
          Submit a probability for every bucket and revise it until the question closes. Scores are
          the time-averaged log probability you held on the outcome, so early, steady accuracy
          counts most. Every forecast is public and keyed by X handle.
        </p>
      </header>
      <TournamentBoard initialQuestions={questions} />
      <p className={styles.disclosure}>
        <strong>No money moves here.</strong> The tournament produces a ranking per prize period;
        prizes, if any, are handled off-platform.
      </p>
    </div>
  );
}
