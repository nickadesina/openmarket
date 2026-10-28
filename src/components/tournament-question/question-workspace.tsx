"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiRequest } from "../../lib/client/api.js";
import {
  formatCoverage,
  formatForecasterName,
  formatProbability,
  formatScore,
  formatScoreWhole,
  formatTimeUntil,
  formatTournamentDateTime,
  formatTournamentForecast,
  formatTournamentOutcome,
  formatTournamentValue,
  tournamentKindCaption,
  tournamentSettleSentences,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import {
  forwardRuleScores,
  tournamentCrowdValue,
  tournamentMarketValue,
  useNow,
  useTournamentViewer,
} from "../../lib/client/tournament.js";
import type { ForecasterProfile } from "../../lib/services/tournament/forecaster.js";
import type {
  PublicForecast,
  QuestionDetail,
  ResolutionDetail,
} from "../../lib/services/tournament/get-question.js";
import type { AggregateView } from "../../lib/services/tournament/records.js";
import { ForecasterName } from "../tournament-forecaster-name/forecaster-name.js";
import { Markdown } from "../tournament-markdown/markdown.js";
import { CrowdHistory } from "./crowd-history.js";
import { ForecastEditor } from "./forecast-editor.js";
import styles from "./tournament-question.module.css";

/** The crowd's one figure: "42.0% YES" on a binary, "$412B median" on a forward. */
function crowdFigure(question: QuestionDetail, aggregate: AggregateView): string | null {
  const value = tournamentCrowdValue(question, aggregate);
  if (value === null) return null;
  if (question.kind === "binary") return `${formatProbability(value)} YES`;
  return question.unit === null ? null : `${formatTournamentValue(value, question.unit)} median`;
}

/** The linked contract's latest figure: the binary's YES price, or the forward's dealer mid. */
function marketFigure(question: QuestionDetail): string | null {
  const value = tournamentMarketValue(question);
  if (value === null) return null;
  if (question.kind === "binary") return formatProbability(value);
  return question.unit === null ? null : formatTournamentValue(value, question.unit);
}

function CrowdModule({ question }: { readonly question: QuestionDetail }) {
  const aggregate = question.aggregate;
  const figure = aggregate === null ? null : crowdFigure(question, aggregate);
  const market = marketFigure(question);
  const marketRow =
    market === null ? null : (
      <div>
        <dt>{question.kind === "binary" ? "Market" : "Dealer mid"}</dt>
        <dd>{market}</dd>
      </div>
    );
  if (aggregate === null || figure === null) {
    const count = aggregate?.nForecasters ?? 0;
    return (
      <div className={styles.crowdPending}>
        <div className={styles.statePanel}>
          <strong>Not enough forecasts yet.</strong>
          <p>
            The crowd&apos;s {question.kind === "binary" ? "chance of YES" : "median level"} is
            published once {question.rules.minPublishedForecasters} forecasters are on file; {count}{" "}
            {count === 1 ? "is" : "are"} so far. Individual forecasts are public below.
          </p>
        </div>
        {marketRow === null ? null : <dl className={styles.specTable}>{marketRow}</dl>}
      </div>
    );
  }
  return (
    <div className={styles.crowd}>
      <dl className={styles.specTable}>
        <div>
          <dt>Crowd</dt>
          <dd className={styles.priceFigure}>{figure}</dd>
        </div>
        <div>
          <dt>Forecasters</dt>
          <dd>{aggregate.nForecasters}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatTournamentDateTime(aggregate.computedAt)}</dd>
        </div>
        {marketRow}
      </dl>
      <CrowdHistory question={question} />
    </div>
  );
}

/**
 * The viewer's own score beside the outcome, read from their profile's
 * stored score rows; nothing when they did not forecast or have no row.
 */
function ViewerScoreRow({ slug }: { readonly slug: string }) {
  const viewer = useTournamentViewer().data?.viewer ?? null;
  const profileSlug =
    viewer !== null && viewer.forecasts[slug] !== undefined ? viewer.identity.profileSlug : null;
  const profile = useQuery({
    queryKey: queryKeys.tournamentForecaster(profileSlug ?? "none"),
    queryFn: () =>
      apiRequest<ForecasterProfile>(`/api/t/users/${encodeURIComponent(profileSlug ?? "")}`),
    enabled: profileSlug !== null,
  });
  const own = profile.data?.resolved.find((position) => position.slug === slug);
  if (profileSlug === null || own === undefined) return null;
  return (
    <div>
      <dt>Your score</dt>
      <dd>
        {formatScore(own.timeAvgLogScore)} · {formatCoverage(own.coverage)} of the window
      </dd>
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
  const final = resolution.finalAggregate;
  const finalFigure = final === null ? null : crowdFigure(question, final);
  return (
    <div className={styles.resolution}>
      <dl className={styles.specTable}>
        {question.kind === "binary" ? (
          <div>
            <dt>Outcome</dt>
            <dd className={styles.priceFigure}>
              {resolution.outcome === null ? "—" : formatTournamentOutcome(resolution.outcome)}
            </dd>
          </div>
        ) : (
          <div>
            <dt>Settled value</dt>
            <dd className={styles.priceFigure}>
              {resolution.resolvedValue === null || question.unit === null
                ? "—"
                : formatTournamentValue(resolution.resolvedValue, question.unit)}
            </dd>
          </div>
        )}
        <ViewerScoreRow slug={question.slug} />
        <div>
          <dt>Source rank</dt>
          <dd>{resolution.rungFired ?? "—"}</dd>
        </div>
        {final === null ? null : (
          <div>
            <dt>Crowd at close</dt>
            <dd>
              {finalFigure ??
                `Not published · ${final.nForecasters} forecaster${final.nForecasters === 1 ? "" : "s"}`}
            </dd>
          </div>
        )}
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
      <h3 className={styles.subheading}>Top forecasters</h3>
      {resolution.topForecasters.length === 0 ? (
        <p className={styles.muted}>Nobody forecast this question.</p>
      ) : (
        <table className={styles.table}>
          <thead className={styles.head}>
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
              <tr key={entry.profileSlug}>
                <td className={styles.figureCell}>{index + 1}</td>
                <td>
                  <ForecasterName identity={entry} />
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

function ForecastsTable({
  question,
  forecasts,
}: {
  readonly question: QuestionDetail;
  readonly forecasts: readonly PublicForecast[];
}) {
  if (forecasts.length === 0) {
    return <p className={styles.emptyNote}>No forecasts yet. The first one opens the record.</p>;
  }
  return (
    <table className={`${styles.table} ${styles.forecastTable}`}>
      <caption className={styles.visuallyHidden}>Latest forecast per forecaster</caption>
      <thead className={styles.head}>
        <tr>
          <th scope="col">Forecaster</th>
          <th scope="col" className={styles.figureCell}>
            Forecast
          </th>
          <th scope="col">Updated</th>
          <th scope="col" className={styles.figureCell}>
            Revisions
          </th>
          <th scope="col">Proof</th>
        </tr>
      </thead>
      <tbody>
        {forecasts.map((forecast) => (
          <tr key={forecast.profileSlug}>
            <td data-label="Forecaster">
              <ForecasterName identity={forecast} />
            </td>
            <td data-label="Forecast" className={styles.figureCell}>
              {formatTournamentForecast(question, forecast) ?? "—"}
            </td>
            <td data-label="Updated">{formatTournamentDateTime(forecast.submittedAt)}</td>
            <td data-label="Revisions" className={styles.figureCell}>
              {forecast.submissionCount}
            </td>
            <td data-label="Proof">
              <Link
                className={styles.proofLink}
                href={`/t/provenance/${forecast.eventId}`}
                aria-label={`Timestamp proof for ${formatForecasterName(forecast)}'s forecast`}
              >
                Proof
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScoringNote({ question }: { readonly question: QuestionDetail }) {
  const { rules } = question;
  const scores = forwardRuleScores();
  const ageRule =
    question.minAccountAgeDays > 0
      ? ` X accounts must be at least ${question.minAccountAgeDays} days old to forecast.`
      : "";
  if (question.kind === "binary") {
    return (
      <p className={styles.muted}>
        Scored by time-averaged log score on the chance you held on the outcome, 100 / ln 2 ·
        ln(2p): 100 is certain and right for the whole window, 0 is 50%, and a chance below{" "}
        {formatProbability(rules.epsilon)} counts as {formatProbability(rules.epsilon)}, which
        scores {formatScore(rules.clampScore)}. Time before your first forecast counts as 0. The
        crowd is the geometric mean of odds across forecasters, extremized at a ={" "}
        {rules.extremization} ({rules.weightingVersion}).{ageRule}
      </p>
    );
  }
  return (
    <p className={styles.muted}>
      Scored by time-averaged distance from the settling value y, 100 · (1 − |ln(x / y)| / ln 2) for
      a level x: exact is {formatScoreWhole(scores.exact).replace(/^\+/, "")}, 10% off about{" "}
      {formatScoreWhole(scores.near).replace(/^\+/, "")}, 2× off {formatScoreWhole(scores.double)}{" "}
      and 4× off {formatScoreWhole(scores.quadruple)}, never below {formatScore(rules.clampScore)}.
      Time before your first forecast counts as 0. If the question voids, nothing is scored. The
      crowd is the median of forecasters&apos; levels, taken in logs.
      {ageRule}
    </p>
  );
}

const RULEBOOK_ID = "rulebook";

/**
 * "How this settles": what settles the question and what happens otherwise,
 * from its kind, level and expiry. The condition is the rulebook's, linked
 * rather than paraphrased.
 */
function SettlesBlock({ question }: { readonly question: QuestionDetail }) {
  const [settles, otherwise] = tournamentSettleSentences(question);
  return (
    <section className={styles.module} aria-labelledby="settles-title">
      <h2 className={styles.tab} id="settles-title">
        How this settles
      </h2>
      <div className={styles.settles}>
        <p>
          {settles} {otherwise}
        </p>
        <a className={styles.rulesLink} href={`#${RULEBOOK_ID}`}>
          Full rules
        </a>
      </div>
    </section>
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
  const questionQuery = useQuery({
    queryKey: queryKeys.tournamentQuestion(slug),
    queryFn: () => apiRequest<QuestionDetail>(`/api/t/questions/${encodeURIComponent(slug)}`),
    ...(initialQuestion === null ? {} : { initialData: initialQuestion }),
    refetchInterval: 15_000,
  });
  const forecastsQuery = useQuery({
    queryKey: queryKeys.tournamentForecasts(slug),
    queryFn: () =>
      apiRequest<{ forecasts: PublicForecast[] }>(
        `/api/t/questions/${encodeURIComponent(slug)}/forecasts`,
      ).then((body) => body.forecasts),
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
  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <h1>{question.title}</h1>
        {question.proposedBy === null ? null : (
          <p className={styles.proposedBy}>Proposed by {question.proposedBy}</p>
        )}
        <p className={styles.headerMeta}>
          <span>{tournamentKindCaption(question)}</span>
          <span>{windowLine(question, now)}</span>
          {question.xThreadUrl === null ? null : (
            <a href={question.xThreadUrl} target="_blank" rel="noopener noreferrer">
              Discussion on X
            </a>
          )}
        </p>
      </header>

      <SettlesBlock question={question} />

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
              Crowd
            </h2>
            <CrowdModule question={question} />
          </section>
        ) : null}

        {question.acceptingForecasts ? (
          <section className={styles.module} aria-labelledby="editor-title">
            <h2 className={styles.actionTab} id="editor-title">
              Your forecast
            </h2>
            <ForecastEditor question={question} />
          </section>
        ) : null}
      </div>

      <section className={styles.module} aria-labelledby="rulebook-title" id={RULEBOOK_ID}>
        <h2 className={styles.tab} id="rulebook-title">
          Rulebook v{question.rulebookVersion}
        </h2>
        <div className={styles.rulebook}>
          <Markdown source={question.descriptionMd} />
          <Markdown source={question.rulebookMd} />
          <ScoringNote question={question} />
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
