"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiRequest } from "../../lib/client/api.js";
import {
  formatCoverage,
  formatProbability,
  formatScore,
  formatTimeUntil,
  formatTournamentDateTime,
  formatTournamentMedian,
  formatTournamentValue,
  tournamentUnitCaption,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { useNow, useTournamentViewer } from "../../lib/client/tournament.js";
import type { Bucket } from "../../lib/engine/tournament/buckets.js";
import type {
  PublicForecast,
  QuestionDetail,
  ResolutionDetail,
} from "../../lib/services/tournament/get-question.js";
import type { AggregateView } from "../../lib/services/tournament/records.js";
import { TournamentDistribution } from "../tournament-distribution/tournament-distribution.js";
import { Markdown } from "../tournament-markdown/markdown.js";
import { ForecastEditor } from "./forecast-editor.js";
import styles from "./tournament-question.module.css";

function aggregateSummary(question: QuestionDetail, aggregate: AggregateView): string {
  const parts = [`${aggregate.nForecasters} forecasters`];
  if (aggregate.pYes !== null) parts.push(`${formatProbability(aggregate.pYes)} yes`);
  if (aggregate.medianValue !== null) {
    parts.push(
      `median ${formatTournamentMedian(aggregate.medianValue, aggregate.medianPosition, question.unit)}`,
    );
  }
  if (aggregate.pFloor !== null) parts.push(`${formatProbability(aggregate.pFloor)} on the floor`);
  return `Crowd distribution: ${parts.join(", ")}.`;
}

function CrowdModule({
  question,
  viewerProbs,
}: {
  readonly question: QuestionDetail;
  readonly viewerProbs: readonly number[] | null;
}) {
  const aggregate = question.aggregate;
  if (aggregate === null || !aggregate.published || aggregate.probs === null) {
    const count = aggregate?.nForecasters ?? 0;
    return (
      <div className={styles.statePanel}>
        <strong>Not enough forecasts yet.</strong>
        <p>
          The crowd distribution is published once {question.rules.minPublishedForecasters}{" "}
          forecasters are on file; {count} {count === 1 ? "is" : "are"} so far. Individual forecasts
          are public below.
        </p>
      </div>
    );
  }
  return (
    <div className={styles.crowd}>
      <TournamentDistribution
        buckets={question.buckets}
        unit={question.unit}
        primary={{ label: "Crowd", probs: aggregate.probs }}
        overlay={viewerProbs === null ? null : { label: "You", probs: viewerProbs }}
        median={
          aggregate.medianValue === null || aggregate.medianPosition === null
            ? null
            : { value: aggregate.medianValue, position: aggregate.medianPosition }
        }
        winningIndex={question.resolution?.winningBucketIndex ?? null}
        summary={aggregateSummary(question, aggregate)}
      />
      <dl className={styles.specTable}>
        {question.unit === "bool" ? (
          <div>
            <dt>P(yes)</dt>
            <dd className={styles.priceFigure}>{formatProbability(aggregate.pYes ?? 0)}</dd>
          </div>
        ) : (
          <>
            <div>
              <dt>Median</dt>
              <dd className={styles.priceFigure}>
                {aggregate.medianValue === null
                  ? "—"
                  : formatTournamentMedian(
                      aggregate.medianValue,
                      aggregate.medianPosition,
                      question.unit,
                    )}
              </dd>
            </div>
            <div>
              <dt>P(floor)</dt>
              <dd>{aggregate.pFloor === null ? "—" : formatProbability(aggregate.pFloor)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Forecasters</dt>
          <dd>{aggregate.nForecasters}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatTournamentDateTime(aggregate.computedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

function ResolutionModule({
  question,
  resolution,
}: {
  readonly question: QuestionDetail;
  readonly resolution: ResolutionDetail;
}) {
  const winner = question.buckets[resolution.winningBucketIndex]!;
  const final = resolution.finalAggregate;
  return (
    <div className={styles.resolution}>
      <dl className={styles.specTable}>
        <div>
          <dt>Winning bucket</dt>
          <dd className={styles.priceFigure}>{winner.label}</dd>
        </div>
        <div>
          <dt>Resolved value</dt>
          <dd>
            {resolution.resolvedValue === null
              ? "—"
              : formatTournamentValue(resolution.resolvedValue, question.unit)}
          </dd>
        </div>
        <div>
          <dt>Rung fired</dt>
          <dd>{resolution.rungFired ?? "—"}</dd>
        </div>
        <div>
          <dt>Resolved</dt>
          <dd>{formatTournamentDateTime(resolution.resolvedAt)}</dd>
        </div>
        <div>
          <dt>Dispute window ends</dt>
          <dd>{formatTournamentDateTime(resolution.disputeWindowEndsAt)}</dd>
        </div>
        <div>
          <dt>Crowd score</dt>
          <dd>
            {resolution.aggregateScore === null
              ? "—"
              : formatScore(resolution.aggregateScore.timeAvgLogScore)}
          </dd>
        </div>
      </dl>
      {resolution.sourceUrl === null ? null : (
        <div className={styles.source}>
          <a href={resolution.sourceUrl} target="_blank" rel="noopener noreferrer">
            Resolution source
          </a>
          {resolution.sourceExcerpt === null ? null : (
            <blockquote>{resolution.sourceExcerpt}</blockquote>
          )}
        </div>
      )}
      <Markdown source={resolution.noteMd} />
      {resolution.supersededCount > 0 ? (
        <p className={styles.muted}>
          This resolution replaced {resolution.supersededCount} earlier one
          {resolution.supersededCount === 1 ? "" : "s"} inside the dispute window.
        </p>
      ) : null}
      {resolution.notes.map((note) => (
        <div className={styles.note} key={note.createdAt}>
          <span className={styles.noteStamp}>{formatTournamentDateTime(note.createdAt)}</span>
          <Markdown source={note.noteMd} />
        </div>
      ))}
      {final?.probs == null ? null : (
        <TournamentDistribution
          buckets={question.buckets}
          unit={question.unit}
          primary={{ label: "Crowd at close", probs: final.probs }}
          median={
            final.medianValue === null || final.medianPosition === null
              ? null
              : { value: final.medianValue, position: final.medianPosition }
          }
          winningIndex={resolution.winningBucketIndex}
          summary={`Crowd at close across ${final.nForecasters} forecasters; ${winner.label} won with ${formatProbability(final.probs[resolution.winningBucketIndex] ?? 0)}.`}
        />
      )}
      <h3 className={styles.subheading}>Top forecasters</h3>
      {resolution.topForecasters.length === 0 ? (
        <p className={styles.muted}>Nobody forecast this question.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.figureCell}>
                #
              </th>
              <th scope="col">Forecaster</th>
              <th scope="col" className={styles.figureCell}>
                Score
              </th>
              <th scope="col" className={styles.figureCell}>
                Final
              </th>
              <th scope="col" className={styles.figureCell}>
                Coverage
              </th>
            </tr>
          </thead>
          <tbody>
            {resolution.topForecasters.map((entry, index) => (
              <tr key={entry.handle}>
                <td className={styles.figureCell}>{index + 1}</td>
                <td>
                  <HandleLink handle={entry.handle} flagged={entry.flagged} />
                </td>
                <td className={styles.figureCell}>{formatScore(entry.timeAvgLogScore)}</td>
                <td className={styles.figureCell}>{formatScore(entry.finalLogScore)}</td>
                <td className={styles.figureCell}>{formatCoverage(entry.coverage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function HandleLink({
  handle,
  flagged,
}: {
  readonly handle: string;
  readonly flagged: boolean;
}) {
  return (
    <span className={styles.handle}>
      <Link href={`/t/u/${handle}`}>@{handle}</Link>
      {flagged ? (
        <span className={styles.flag} title="Flagged: excluded from the crowd aggregate">
          Flagged
        </span>
      ) : null}
    </span>
  );
}

function BucketTable({ buckets }: { readonly buckets: readonly Bucket[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col" className={styles.figureCell}>
            #
          </th>
          <th scope="col">Bucket</th>
          <th scope="col" className={styles.figureCell}>
            From (inclusive)
          </th>
          <th scope="col" className={styles.figureCell}>
            To (exclusive)
          </th>
        </tr>
      </thead>
      <tbody>
        {buckets.map((bucket) => (
          <tr key={bucket.index}>
            <td className={styles.figureCell}>{bucket.index}</td>
            <td>{bucket.label}</td>
            <td className={styles.figureCell}>
              {bucket.kind === "floor" ? "Floor" : (bucket.lower ?? "−∞")}
            </td>
            <td className={styles.figureCell}>
              {bucket.kind === "floor" ? "—" : (bucket.upper ?? "+∞")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ForecastsTable({
  question,
  forecasts,
}: {
  readonly question: QuestionDetail;
  readonly forecasts: readonly PublicForecast[];
}) {
  if (forecasts.length === 0) {
    return <p className={styles.muted}>No forecasts yet. The first one opens the record.</p>;
  }
  return (
    <ul className={styles.forecastList}>
      {forecasts.map((forecast) => (
        <li key={forecast.handle}>
          <div className={styles.forecastMeta}>
            <HandleLink handle={forecast.handle} flagged={forecast.flagged} />
            <span className={styles.muted}>
              {formatTournamentDateTime(forecast.submittedAt)} · {forecast.submissionCount}{" "}
              submission{forecast.submissionCount === 1 ? "" : "s"} ·{" "}
              <Link
                className={styles.proofLink}
                href={`/t/provenance/${forecast.eventId}`}
                aria-label={`Timestamp proof for @${forecast.handle}'s forecast`}
              >
                Proof
              </Link>
            </span>
          </div>
          <TournamentDistribution
            compact
            buckets={question.buckets}
            unit={question.unit}
            primary={{ label: `@${forecast.handle}`, probs: forecast.probs }}
            summary={forecast.probs
              .map(
                (probability, index) =>
                  `${question.buckets[index]!.label} ${formatProbability(probability)}`,
              )
              .join(" · ")}
          />
        </li>
      ))}
    </ul>
  );
}

function windowLine(question: QuestionDetail, now: number | null): string {
  const closes = formatTournamentDateTime(question.windowEndsAt);
  if (question.status === "voided") return "Voided. No scores are written.";
  if (question.status === "resolved") return `Closed ${closes}.`;
  if (question.status === "closed") return `Closed ${closes}. Awaiting resolution.`;
  if (now !== null && Date.parse(question.opensAt) > now) {
    return `Opens ${formatTournamentDateTime(question.opensAt)}; closes ${closes}.`;
  }
  return `Closes ${closes}${now === null ? "" : ` (${formatTimeUntil(question.windowEndsAt, now)})`}.`;
}

export function QuestionWorkspace({
  slug,
  initialQuestion,
  initialForecasts,
}: {
  readonly slug: string;
  readonly initialQuestion: QuestionDetail | null;
  readonly initialForecasts: readonly PublicForecast[] | null;
}) {
  const now = useNow();
  const viewer = useTournamentViewer();
  const questionQuery = useQuery({
    queryKey: queryKeys.tournamentQuestion(slug),
    queryFn: () => apiRequest<QuestionDetail>(`/api/t/questions/${slug}`),
    ...(initialQuestion === null ? {} : { initialData: initialQuestion }),
    refetchInterval: 15_000,
  });
  const forecastsQuery = useQuery({
    queryKey: queryKeys.tournamentForecasts(slug),
    queryFn: () =>
      apiRequest<{ forecasts: PublicForecast[] }>(`/api/t/questions/${slug}/forecasts`).then(
        (body) => body.forecasts,
      ),
    ...(initialForecasts === null ? {} : { initialData: [...initialForecasts] }),
    refetchInterval: 15_000,
  });

  if (questionQuery.isPending) {
    return <div className={styles.skeleton} role="status" aria-label="Loading question" />;
  }
  if (questionQuery.isError) {
    return (
      <div className={styles.statePanel} role="alert">
        <strong>This question could not be loaded.</strong>
        <p>{questionQuery.error.message}</p>
        <Link className={styles.secondaryButton} href="/t">
          All questions
        </Link>
      </div>
    );
  }

  const question = questionQuery.data;
  const viewerProbs = viewer.data?.viewer?.forecasts[question.slug]?.probs ?? null;
  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <h1>{question.title}</h1>
        <p className={styles.headerMeta}>
          <span>{tournamentUnitCaption(question.unit)}</span>
          <span>{windowLine(question, now)}</span>
          {question.xThreadUrl === null ? null : (
            <a href={question.xThreadUrl} target="_blank" rel="noopener noreferrer">
              Discussion on X
            </a>
          )}
        </p>
      </header>

      {question.status === "voided" && question.voidNoteMd !== null ? (
        <section className={styles.module} aria-labelledby="void-title">
          <h2 className={styles.tab} id="void-title">
            Voided
          </h2>
          <Markdown source={question.voidNoteMd} />
        </section>
      ) : null}

      {question.resolutionDetail === null ? null : (
        <section className={styles.module} aria-labelledby="resolution-title">
          <h2 className={styles.tab} id="resolution-title">
            Resolution
          </h2>
          <ResolutionModule question={question} resolution={question.resolutionDetail} />
        </section>
      )}

      <div className={styles.workspace}>
        {/* A resolved question shows the crowd at close inside its resolution instead. */}
        {question.resolutionDetail === null ? (
          <section className={styles.module} aria-labelledby="crowd-title">
            <h2 className={styles.tab} id="crowd-title">
              Crowd distribution
            </h2>
            <CrowdModule question={question} viewerProbs={viewerProbs} />
          </section>
        ) : null}

        {question.acceptingForecasts ? (
          <section className={styles.module} aria-labelledby="editor-title">
            <h2 className={styles.tab} id="editor-title">
              Your forecast
            </h2>
            <ForecastEditor question={question} />
          </section>
        ) : null}
      </div>

      <section className={styles.module} aria-labelledby="rulebook-title">
        <h2 className={styles.tab} id="rulebook-title">
          Rulebook v{question.rulebookVersion}
        </h2>
        <div className={styles.rulebook}>
          <Markdown source={question.descriptionMd} />
          <Markdown source={question.rulebookMd} />
          {question.unit === "bool" ? null : <BucketTable buckets={question.buckets} />}
          <p className={styles.muted}>
            Scored by time-averaged log score relative to uniform: 0 is uniform, 100 is certain and
            right for the whole window, and time before your first forecast counts as uniform. The
            crowd is the geometric mean of odds across forecasters, extremized at a ={" "}
            {question.rules.extremization} ({question.rules.weightingVersion}), with each vector
            clamped at {formatProbability(question.rules.epsilon)}.
            {question.minAccountAgeDays > 0
              ? ` X accounts must be at least ${question.minAccountAgeDays} days old to forecast.`
              : ""}
          </p>
        </div>
      </section>

      <section className={styles.module} aria-labelledby="forecasts-title">
        <h2 className={styles.tab} id="forecasts-title">
          Latest forecasts
        </h2>
        <ForecastsTable question={question} forecasts={forecastsQuery.data ?? []} />
      </section>
    </article>
  );
}
