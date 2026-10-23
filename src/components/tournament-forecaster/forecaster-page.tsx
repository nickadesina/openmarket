"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiRequest } from "../../lib/client/api.js";
import {
  formatCoverage,
  formatForecasterName,
  formatScore,
  formatTournamentDateTime,
  formatTournamentForecast,
  formatTournamentOutcome,
  formatTournamentValue,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { useTournamentViewer } from "../../lib/client/tournament.js";
import type {
  ForecasterProfile,
  OpenPosition,
  ResolvedPosition,
} from "../../lib/services/tournament/forecaster.js";
import { DemoTag } from "../market-demo/market-demo.js";
import { AffiliationEditor } from "./affiliation-editor.js";
import styles from "./forecaster-page.module.css";
import { RestrictionsEditor } from "./restrictions-editor.js";

function crowdHeadline(position: OpenPosition): string {
  const aggregate = position.aggregate;
  if (aggregate === null || !aggregate.published) return "Not published";
  return formatTournamentForecast(position, aggregate) ?? "Not published";
}

/** A resolved question's outcome: YES or NO, or the settled level. */
function outcomeLabel(position: ResolvedPosition): string {
  if (position.outcome !== null) return formatTournamentOutcome(position.outcome);
  if (position.resolvedValue !== null && position.unit !== null) {
    return formatTournamentValue(position.resolvedValue, position.unit);
  }
  return "—";
}

function OpenPositionRow({
  position,
  ownLabel,
}: {
  readonly position: OpenPosition;
  readonly ownLabel: string;
}) {
  return (
    <li className={styles.position}>
      <div className={styles.positionHeader}>
        <Link className={styles.questionLink} href={`/t/q/${position.slug}`}>
          {position.title}
        </Link>
        {position.status === "closed" ? <span className={styles.closedMark}>Closed</span> : null}
      </div>
      <dl className={styles.figures}>
        <div>
          <dt>{ownLabel}</dt>
          <dd className={styles.own}>{formatTournamentForecast(position, position) ?? "—"}</dd>
        </div>
        <div>
          <dt>Crowd</dt>
          <dd>{crowdHeadline(position)}</dd>
        </div>
        <div>
          <dt>Revisions</dt>
          <dd>{position.submissionCount}</dd>
        </div>
      </dl>
      <p className={styles.updated}>Updated {formatTournamentDateTime(position.lastUpdatedAt)}</p>
    </li>
  );
}

export function ForecasterPage({
  handle,
  initialProfile,
}: {
  readonly handle: string;
  readonly initialProfile: ForecasterProfile | null;
}) {
  const viewer = useTournamentViewer();
  const profileQuery = useQuery({
    queryKey: queryKeys.tournamentForecaster(handle),
    queryFn: () => apiRequest<ForecasterProfile>(`/api/t/users/${encodeURIComponent(handle)}`),
    ...(initialProfile === null ? {} : { initialData: initialProfile }),
    refetchInterval: 30_000,
  });

  if (profileQuery.isPending) {
    return <div className={styles.skeleton} role="status" aria-label="Loading forecaster" />;
  }
  if (profileQuery.isError) {
    return (
      <div className={styles.statePanel} role="alert">
        <strong>No forecaster {handle}.</strong>
        <p>Profiles appear once someone signs in and submits a forecast.</p>
        <Link className={styles.backLink} href="/t/leaderboard">
          Leaderboard
        </Link>
      </div>
    );
  }

  const profile = profileQuery.data;
  const { identity } = profile;
  const name = formatForecasterName(identity);
  const ownProfile = viewer.data?.viewer?.identity.profileSlug === identity.profileSlug;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {identity.avatarUrl === null ? null : (
          // biome-ignore lint/performance/noImgElement: X avatars are remote, tiny, and not worth an image-optimizer domain.
          <img className={styles.avatar} src={identity.avatarUrl} alt="" width={96} height={96} />
        )}
        <div>
          <div className={styles.nameRow}>
            <h1>
              {identity.provider === "x" ? (
                <a
                  href={`https://x.com/${identity.handle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {name}
                </a>
              ) : (
                name
              )}
            </h1>
            {identity.affiliation === null ? null : (
              <span className={styles.affiliation} title="Self-reported affiliation">
                {identity.affiliation}
              </span>
            )}
          </div>
          <p className={styles.headerMeta}>
            {identity.displayName === identity.handle ? null : <span>{identity.displayName}</span>}
            {identity.demo ? <DemoTag /> : null}
            {identity.provider === "password" && !identity.demo ? (
              <span>Username account</span>
            ) : null}
            {identity.verified ? <span>Verified on X</span> : null}
            {identity.flagged ? (
              <span className={styles.flag}>Flagged: excluded from the crowd</span>
            ) : null}
          </p>
        </div>
        <dl className={styles.total}>
          <dt>Total score</dt>
          <dd>{formatScore(profile.totalScore)}</dd>
        </dl>
      </header>

      {ownProfile ? <AffiliationEditor current={identity.affiliation} /> : null}
      {ownProfile ? <RestrictionsEditor /> : null}

      <section className={styles.section} aria-labelledby="open-title">
        <h2 className={styles.tab} id="open-title">
          Open positions
        </h2>
        {profile.open.length === 0 ? (
          <p className={styles.empty}>No open forecasts.</p>
        ) : (
          <ul className={styles.positions}>
            {profile.open.map((position) => (
              <OpenPositionRow
                key={position.slug}
                position={position}
                ownLabel={ownProfile ? "You" : name}
              />
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="resolved-title">
        <h2 className={styles.tab} id="resolved-title">
          Resolved
        </h2>
        {profile.resolved.length === 0 ? (
          <p className={styles.empty}>No resolved questions yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Outcome</th>
                <th scope="col" className={styles.figureCell}>
                  Score
                </th>
                <th scope="col" className={styles.figureCell}>
                  Coverage
                </th>
              </tr>
            </thead>
            <tbody>
              {profile.resolved.map((position) => (
                <tr key={position.slug}>
                  <td>
                    <Link className={styles.questionLink} href={`/t/q/${position.slug}`}>
                      {position.title}
                    </Link>
                  </td>
                  <td>{outcomeLabel(position)}</td>
                  <td className={styles.figureCell}>{formatScore(position.timeAvgLogScore)}</td>
                  <td className={styles.figureCell}>{formatCoverage(position.coverage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
