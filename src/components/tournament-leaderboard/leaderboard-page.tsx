"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { apiRequest } from "../../lib/client/api.js";
import { formatCoverage, formatScore, formatTournamentPeriod } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { Leaderboard } from "../../lib/services/tournament/leaderboard.js";
import styles from "./leaderboard-page.module.css";

export function LeaderboardPage({
  period,
  periods,
  initialLeaderboard,
}: {
  readonly period: string;
  /** "all" plus the months that have a resolution, newest first. */
  readonly periods: readonly string[];
  readonly initialLeaderboard: Leaderboard | null;
}) {
  const router = useRouter();
  const leaderboardQuery = useQuery({
    queryKey: queryKeys.tournamentLeaderboard(period),
    queryFn: () => apiRequest<Leaderboard>(`/api/t/leaderboard?period=${period}`),
    ...(initialLeaderboard === null ? {} : { initialData: initialLeaderboard }),
    refetchInterval: 60_000,
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Leaderboard</h1>
          <p>
            Sum of time-averaged log scores over questions resolved in the period, so taking part
            counts. Ties break on mean coverage, the share of each question's window a forecast was
            on file.
          </p>
        </div>
        <label className={styles.periodField}>
          <span>Period</span>
          <select
            value={period}
            onChange={(event) =>
              router.push(
                event.target.value === "all"
                  ? "/t/leaderboard"
                  : `/t/leaderboard?period=${event.target.value}`,
              )
            }
          >
            {periods.map((option) => (
              <option key={option} value={option}>
                {formatTournamentPeriod(option)}
              </option>
            ))}
          </select>
        </label>
      </header>

      {leaderboardQuery.isPending ? (
        <div className={styles.skeleton} role="status" aria-label="Loading leaderboard" />
      ) : leaderboardQuery.isError ? (
        <div className={styles.statePanel} role="alert">
          <strong>The leaderboard could not be loaded.</strong>
          <button
            type="button"
            className={styles.retry}
            onClick={() => void leaderboardQuery.refetch()}
          >
            Retry
          </button>
        </div>
      ) : leaderboardQuery.data.entries.length === 0 ? (
        <div className={styles.statePanel}>
          <strong>No scores in {formatTournamentPeriod(period).toLowerCase()} yet.</strong>
          <p>
            Scores are written when a question resolves. Forecast an open question to be on the
            board when it does.
          </p>
          <Link className={styles.retry} href="/t">
            Open questions
          </Link>
        </div>
      ) : (
        <table className={styles.table}>
          <caption className={styles.caption}>
            {formatTournamentPeriod(period)}, resolutions dated in {leaderboardQuery.data.timeZone}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={styles.figure}>
                Rank
              </th>
              <th scope="col">Forecaster</th>
              <th scope="col" className={styles.figure}>
                Score
              </th>
              <th scope="col" className={styles.figure}>
                Resolved
              </th>
              <th scope="col" className={styles.figure}>
                Coverage
              </th>
            </tr>
          </thead>
          <tbody>
            {leaderboardQuery.data.entries.map((entry) => (
              <tr key={entry.handle}>
                <td className={styles.rank}>{entry.rank}</td>
                <td>
                  <span className={styles.forecaster}>
                    {entry.avatarUrl === null ? (
                      <span className={styles.avatarFallback} aria-hidden="true" />
                    ) : (
                      // biome-ignore lint/performance/noImgElement: X avatars are remote, tiny, and not worth an image-optimizer domain.
                      <img
                        className={styles.avatar}
                        src={entry.avatarUrl}
                        alt=""
                        width={28}
                        height={28}
                      />
                    )}
                    <Link href={`/t/u/${entry.handle}`}>@{entry.handle}</Link>
                    <a
                      className={styles.xLink}
                      href={`https://x.com/${entry.handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`@${entry.handle} on X`}
                    >
                      X
                    </a>
                    {entry.flagged ? <span className={styles.flag}>Flagged</span> : null}
                  </span>
                </td>
                <td className={styles.score}>{formatScore(entry.totalScore)}</td>
                <td className={styles.figure}>{entry.questionsResolved}</td>
                <td className={styles.figure}>{formatCoverage(entry.meanCoverage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
