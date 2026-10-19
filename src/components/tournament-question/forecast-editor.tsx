"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import {
  errorMessage,
  formatProbability,
  formatScore,
  formatTournamentDateTime,
} from "../../lib/client/format.js";
import { signInHref, useTournamentViewer } from "../../lib/client/tournament.js";
import { pointLogScore } from "../../lib/engine/tournament/score.js";
import type { QuestionDetail } from "../../lib/services/tournament/get-question.js";
import type { StoredForecast } from "../../lib/services/tournament/submit-forecast.js";
import styles from "./tournament-question.module.css";

const WEIGHT_MAX = 100;

function uniformWeights(count: number): number[] {
  return new Array<number>(count).fill(Math.round((WEIGHT_MAX / count) * 10) / 10);
}

function weightsFrom(probs: readonly number[]): number[] {
  return probs.map((probability) => Math.round(probability * WEIGHT_MAX * 10) / 10);
}

function submitError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === "RATE_LIMITED") {
    const seconds = error.details.retryAfterSeconds;
    return `One revision per question every 10 seconds. Try again in ${typeof seconds === "number" ? seconds : 10} s.`;
  }
  return errorMessage(error, "The forecast was not saved. Try again.");
}

/**
 * One slider and one field per bucket. Weights need not sum to 100: the
 * column on the right is the renormalized vector that will be stored, and
 * the score column is what holding it would earn if that bucket wins.
 */
export function ForecastEditor({ question }: { readonly question: QuestionDetail }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const formId = useId();
  const viewerQuery = useTournamentViewer();
  const viewer = viewerQuery.data?.viewer ?? null;
  const previous = viewer?.forecasts[question.slug];
  const count = question.buckets.length;
  const [weights, setWeights] = useState<number[] | null>(null);
  const current =
    weights ?? (previous === undefined ? uniformWeights(count) : weightsFrom(previous.probs));
  const total = current.reduce((sum, weight) => sum + weight, 0);
  const normalized = total > 0 ? current.map((weight) => weight / total) : null;
  const crowd = question.aggregate?.published === true ? question.aggregate.probs : null;

  const submit = useMutation({
    mutationFn: (probs: number[]) =>
      apiRequest<StoredForecast>(`/api/t/questions/${question.slug}/forecasts`, {
        method: "POST",
        body: JSON.stringify({ probs }),
      }),
    onSuccess: (stored) => {
      setWeights(weightsFrom(stored.probs));
      void queryClient.invalidateQueries({ queryKey: ["openmarket", "tournament"] });
    },
  });

  if (viewerQuery.isPending) {
    return <div className={styles.editorSkeleton} role="status" aria-label="Checking sign-in" />;
  }

  if (viewer === null) {
    return (
      <div className={styles.signInPanel}>
        <p>
          <strong>Sign in to forecast.</strong> Use your X account, or a username and password; your
          name is how the leaderboard shows you.
        </p>
        <Link className={styles.primaryButton} href={signInHref(pathname)}>
          Sign in
        </Link>
      </div>
    );
  }

  function setWeight(index: number, value: number) {
    const next = [...current];
    next[index] = Math.min(WEIGHT_MAX, Math.max(0, Number.isFinite(value) ? value : 0));
    setWeights(next);
    submit.reset();
  }

  return (
    <form
      className={styles.editor}
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        if (normalized !== null) submit.mutate(normalized);
      }}
    >
      <h3 className={styles.visuallyHidden} id={`${formId}-title`}>
        Your forecast
      </h3>
      {viewer.firstSubmission ? (
        <p className={styles.publicNotice}>
          <strong>Forecasts are public.</strong> Every vector you submit is shown with your X handle
          and avatar on this page, your profile, and the leaderboard, and stays in the record after
          you revise it.
        </p>
      ) : null}
      <table className={styles.editorTable}>
        <thead>
          <tr>
            <th scope="col">Bucket</th>
            <th scope="col">Weight</th>
            <th scope="col" className={styles.figureCell}>
              Stored
            </th>
            <th scope="col" className={styles.figureCell}>
              Score if it wins
            </th>
          </tr>
        </thead>
        <tbody>
          {question.buckets.map((bucket) => {
            const probability = normalized?.[bucket.index] ?? 0;
            const inputId = `${formId}-bucket-${bucket.index}`;
            return (
              <tr key={bucket.index} className={bucket.kind === "floor" ? styles.floorRow : ""}>
                <th scope="row">
                  <label htmlFor={inputId}>{bucket.label}</label>
                </th>
                <td className={styles.weightCell}>
                  <input
                    type="range"
                    min={0}
                    max={WEIGHT_MAX}
                    step={0.5}
                    value={current[bucket.index]}
                    aria-label={`${bucket.label} weight slider`}
                    onChange={(event) => setWeight(bucket.index, Number(event.target.value))}
                  />
                  <input
                    id={inputId}
                    className={styles.weightInput}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={WEIGHT_MAX}
                    step={0.1}
                    value={current[bucket.index]}
                    onChange={(event) => setWeight(bucket.index, Number(event.target.value))}
                  />
                </td>
                <td className={styles.figureCell}>{formatProbability(probability)}</td>
                <td className={styles.figureCell}>
                  {formatScore(pointLogScore(probability, count))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.muted}>
        A bucket at 0% counts as {formatProbability(question.rules.epsilon)}: time spent there on
        the bucket that wins scores {formatScore(question.rules.clampScore)}, against 0 for uniform
        and 100 for certain.
        {total <= 0 ? " Put weight on at least one bucket." : ""}
      </p>
      <div className={styles.editorActions}>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={crowd === null}
          onClick={() => {
            if (crowd !== null) setWeights(weightsFrom(crowd));
          }}
        >
          Copy the crowd
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => setWeights(uniformWeights(count))}
        >
          Uniform
        </button>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={normalized === null || submit.isPending}
        >
          {submit.isPending
            ? "Submitting…"
            : previous === undefined
              ? "Submit forecast"
              : "Revise forecast"}
        </button>
      </div>
      {submit.isError ? (
        <p className={styles.error} role="alert">
          {submitError(submit.error)}
        </p>
      ) : null}
      {submit.isSuccess ? (
        <p className={styles.stamp} role="status">
          <span>Recorded</span>
          <time dateTime={submit.data.submittedAt}>
            {formatTournamentDateTime(submit.data.submittedAt)}
          </time>
        </p>
      ) : previous !== undefined ? (
        <p className={styles.muted}>
          In force since {formatTournamentDateTime(previous.submittedAt)} ·{" "}
          {previous.submissionCount} submission{previous.submissionCount === 1 ? "" : "s"}
        </p>
      ) : null}
    </form>
  );
}
