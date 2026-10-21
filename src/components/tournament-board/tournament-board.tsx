"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiRequest } from "../../lib/client/api.js";
import {
  formatMultiple,
  formatProbability,
  formatTimeUntil,
  formatTournamentDateTime,
  formatTournamentMedian,
  formatTournamentValue,
  tournamentUnitCaption,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { useNow } from "../../lib/client/tournament.js";
import type { DerivedNumbers } from "../../lib/services/tournament/derived.js";
import type { QuestionSummary } from "../../lib/services/tournament/get-question.js";
import styles from "./tournament-board.module.css";

function crowdHeadline(question: QuestionSummary): string {
  if (question.resolution !== null) {
    const winner = question.buckets[question.resolution.winningBucketIndex];
    return question.resolution.resolvedValue !== null
      ? formatTournamentValue(question.resolution.resolvedValue, question.unit)
      : (winner?.label ?? "Resolved");
  }
  const aggregate = question.aggregate;
  if (aggregate === null || !aggregate.published) return "Not enough forecasts";
  if (question.unit === "bool" && aggregate.pYes !== null) {
    return `${formatProbability(aggregate.pYes)} yes`;
  }
  if (aggregate.medianValue !== null) {
    return formatTournamentMedian(aggregate.medianValue, aggregate.medianPosition, question.unit);
  }
  return "All mass on the floor";
}

function statusLabel(question: QuestionSummary, now: number | null): string {
  if (question.status === "resolved") return "Resolved";
  if (question.status === "voided") return "Voided";
  if (question.status === "closed") return "Closed, awaiting resolution";
  if (!question.acceptingForecasts && now !== null && Date.parse(question.opensAt) > now) {
    return `Opens ${formatTimeUntil(question.opensAt, now)}`;
  }
  return now === null ? "Open" : `Closes ${formatTimeUntil(question.windowEndsAt, now)}`;
}

function DerivedStrip({ derived }: { readonly derived: DerivedNumbers }) {
  if (!derived.marketCap.available && !derived.arr.available) return null;
  return (
    <dl className={styles.derived} aria-label="Cross-question derived number">
      <div>
        <dt>Implied EV/ARR</dt>
        <dd className={styles.derivedFigure}>
          {derived.impliedEvArr === null ? "—" : formatMultiple(derived.impliedEvArr)}
        </dd>
      </div>
      <div>
        <dt>Day-one market cap</dt>
        <dd>
          {derived.marketCap.value === null
            ? "—"
            : formatTournamentValue(derived.marketCap.value, "USD_T")}
          <small>{derived.marketCap.source === "resolution" ? " resolved" : " crowd median"}</small>
        </dd>
      </div>
      <div>
        <dt>S-1 ARR</dt>
        <dd>
          {derived.arr.value === null ? "—" : formatTournamentValue(derived.arr.value, "USD_B")}
          <small>{derived.arr.source === "resolution" ? " resolved" : " crowd median"}</small>
        </dd>
      </div>
    </dl>
  );
}

export function TournamentBoard({
  initialQuestions,
  initialDerived,
}: {
  readonly initialQuestions: readonly QuestionSummary[] | undefined;
  readonly initialDerived: DerivedNumbers | undefined;
}) {
  const now = useNow();
  const questionsQuery = useQuery({
    queryKey: queryKeys.tournamentQuestions,
    queryFn: () =>
      apiRequest<{ questions: QuestionSummary[] }>("/api/t/questions").then(
        (body) => body.questions,
      ),
    ...(initialQuestions === undefined ? {} : { initialData: [...initialQuestions] }),
    refetchInterval: 30_000,
  });
  const derivedQuery = useQuery({
    queryKey: queryKeys.tournamentDerived,
    queryFn: () => apiRequest<DerivedNumbers>("/api/t/derived"),
    ...(initialDerived === undefined ? {} : { initialData: initialDerived }),
    refetchInterval: 30_000,
  });

  if (questionsQuery.isPending) {
    return <div className={styles.skeleton} role="status" aria-label="Loading questions" />;
  }
  if (questionsQuery.isError) {
    return (
      <div className={styles.statePanel} role="alert">
        <strong>Questions could not be loaded.</strong>
        <p>The tournament API did not respond. Try again in a moment.</p>
        <button
          type="button"
          className={styles.retry}
          onClick={() => void questionsQuery.refetch()}
        >
          Retry
        </button>
      </div>
    );
  }

  const questions = questionsQuery.data;
  return (
    <div className={styles.board}>
      {derivedQuery.data === undefined ? null : <DerivedStrip derived={derivedQuery.data} />}
      {questions.length === 0 ? (
        <div className={styles.statePanel}>
          <strong>No questions are open yet.</strong>
          <p>
            Questions appear here once an admin opens them, with their rulebook pinned before the
            first forecast.
          </p>
        </div>
      ) : (
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>Tournament questions</caption>
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">Crowd</th>
              <th scope="col">Forecasters</th>
              <th scope="col">Window</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((question) => (
              <tr key={question.slug}>
                <td data-label="Question">
                  <div>
                    <Link className={styles.questionLink} href={`/t/q/${question.slug}`}>
                      {question.title}
                    </Link>
                    <span className={styles.unit}>{tournamentUnitCaption(question.unit)}</span>
                  </div>
                </td>
                <td
                  data-label="Crowd"
                  className={
                    question.resolution === null && question.aggregate?.published !== true
                      ? styles.crowdPending
                      : styles.crowd
                  }
                >
                  <div>
                    {crowdHeadline(question)}
                    {question.aggregate?.published === true &&
                    question.aggregate.pFloor !== null ? (
                      <span className={styles.sub}>
                        {formatProbability(question.aggregate.pFloor)} on the floor
                      </span>
                    ) : null}
                  </div>
                </td>
                <td data-label="Forecasters" className={styles.figure}>
                  <div>{question.aggregate?.nForecasters ?? 0}</div>
                </td>
                <td data-label="Window">
                  <div>
                    <span className={styles.status}>{statusLabel(question, now)}</span>
                    <span className={styles.sub}>
                      {formatTournamentDateTime(
                        question.status === "resolved" && question.resolution !== null
                          ? question.resolution.resolvedAt
                          : question.windowEndsAt,
                      )}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
