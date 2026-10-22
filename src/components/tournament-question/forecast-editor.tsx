"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useId, useState } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import {
  errorMessage,
  formatProbability,
  formatScore,
  formatTournamentDate,
  formatTournamentDateTime,
  formatTournamentValue,
  type TournamentUnitLabel,
  tournamentUnitName,
  tournamentUnitSuffix,
  usdInTournamentUnit,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { signInHref, useTournamentViewer } from "../../lib/client/tournament.js";
import { pointLogScore } from "../../lib/engine/tournament/score.js";
import type { ListingDetail } from "../../lib/services/get-market.js";
import type { ViewerForecast } from "../../lib/services/tournament/forecaster.js";
import type { QuestionDetail } from "../../lib/services/tournament/get-question.js";
import styles from "./tournament-question.module.css";

/** The binary field's range in percent: 0.1–99.9, so a stored p is strictly inside (0, 1). */
const PERCENT_MIN = 0.1;
const PERCENT_MAX = 99.9;

/**
 * 0004's forward score at a miss ratio, 100 · (1 − |ln r| / ln 2), before
 * its floor (which binds only past a ~15,000× miss). The preview is three
 * fixed points: the score depends on the ratio alone, not on the level.
 */
function forwardScoreAtRatio(ratio: number): number {
  return 100 * (1 - Math.abs(Math.log(ratio)) / Math.LN2);
}

const FORWARD_PREVIEW = [
  { label: "Exact", ratio: 1 },
  { label: "10% off", ratio: 1.1 },
  { label: "2× off", ratio: 2 },
] as const;

interface Figure {
  readonly label: string;
  readonly chip: string;
  readonly display: string;
  /** What the chip writes into the field; the chip reads pressed while the field holds it. */
  readonly fill: string;
}

function submitError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === "RATE_LIMITED") {
    const seconds = error.details.retryAfterSeconds;
    return `One revision per question every 10 seconds. Try again in ${typeof seconds === "number" ? seconds : 10} s.`;
  }
  return errorMessage(error, "The forecast was not saved. Try again.");
}

function parseNumber(text: string): number | null {
  const trimmed = text.replace(/[,\s]/g, "");
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** A level as a field reads it: four significant digits, no trailing zeros. */
function levelText(value: number): string {
  return String(Number(value.toPrecision(4)));
}

function percentText(p: number): string {
  return String(Math.round(p * 1000) / 10);
}

function useSubmitForecast(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { p: number } | { value: number }) =>
      apiRequest<{ readonly submittedAt: string }>(`/api/t/questions/${slug}/forecasts`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["openmarket", "tournament"] });
    },
  });
}

type SubmitState = ReturnType<typeof useSubmitForecast>;

/** Pressed chips fill ink; a chip fills the field with its figure. */
function Chips({
  figures,
  text,
  onPick,
  label,
}: {
  readonly figures: readonly Figure[];
  readonly text: string;
  readonly onPick: (fill: string) => void;
  readonly label: string;
}) {
  if (figures.length === 0) return null;
  return (
    <div className={styles.chips} role="group" aria-label={label}>
      {figures.map((figure) => (
        <button
          key={figure.label}
          type="button"
          aria-pressed={text === figure.fill}
          onClick={() => onPick(figure.fill)}
        >
          {figure.chip}
        </button>
      ))}
    </div>
  );
}

/** Ruled figure cells; only the figures that exist are drawn. */
function Readout({
  cells,
  label,
}: {
  readonly cells: readonly {
    readonly label: string;
    readonly display: string;
    readonly own?: boolean;
  }[];
  readonly label: string;
}) {
  if (cells.length === 0) return null;
  return (
    <dl className={styles.readout} aria-label={label}>
      {cells.map((cell) => (
        <div key={cell.label} data-active={cell.own === true ? "true" : undefined}>
          <dt>{cell.label}</dt>
          <dd>{cell.display}</dd>
        </div>
      ))}
    </dl>
  );
}

function SubmitRow({
  submit,
  previous,
  ready,
}: {
  readonly submit: SubmitState;
  readonly previous: ViewerForecast | undefined;
  readonly ready: boolean;
}) {
  return (
    <>
      <div className={styles.editorActions}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={!ready || submit.isPending}
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
          {previous.submissionCount} revision{previous.submissionCount === 1 ? "" : "s"}
        </p>
      ) : null}
    </>
  );
}

function BinaryEditor({
  question,
  previous,
  notice,
}: {
  readonly question: QuestionDetail;
  readonly previous: ViewerForecast | undefined;
  readonly notice: ReactNode;
}) {
  const formId = useId();
  const submit = useSubmitForecast(question.slug);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (previous?.p == null ? "50" : percentText(previous.p));
  const percent = parseNumber(text);
  const valid = percent !== null && percent >= PERCENT_MIN && percent <= PERCENT_MAX;
  const p = valid ? percent / 100 : null;

  const crowd =
    question.aggregate?.published === true && question.aggregate.p !== null
      ? question.aggregate.p
      : null;
  const market =
    question.instrument?.kind === "binary" && question.instrument.yesPrice !== null
      ? question.instrument.yesPrice
      : null;
  const figures: Figure[] = [];
  if (crowd !== null) {
    const display = formatProbability(crowd);
    figures.push({ label: "Crowd", chip: `Crowd ${display}`, display, fill: percentText(crowd) });
  }
  if (market !== null) {
    const display = formatProbability(market);
    figures.push({
      label: "Market",
      chip: `Market ${display}`,
      display,
      fill: percentText(market),
    });
  }

  function change(next: string) {
    setDraft(next);
    submit.reset();
  }

  const inputId = `${formId}-p`;
  return (
    <form
      className={styles.editor}
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        if (p !== null) submit.mutate({ p });
      }}
    >
      {notice}
      <h3 className={styles.fieldHead} id={`${formId}-title`}>
        <label htmlFor={inputId}>Chance of YES</label>
      </h3>
      <span className={styles.inputFrame}>
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          min={PERCENT_MIN}
          max={PERCENT_MAX}
          step={0.1}
          autoComplete="off"
          value={text}
          aria-invalid={!valid}
          aria-describedby={`${formId}-error ${formId}-preview`}
          onChange={(event) => change(event.target.value)}
        />
        <span aria-hidden="true">%</span>
      </span>
      <input
        className={styles.slider}
        type="range"
        min={1}
        max={99}
        step={1}
        value={percent === null ? 50 : Math.min(99, Math.max(1, Math.round(percent)))}
        aria-label="Chance of YES, slider"
        onChange={(event) => change(event.target.value)}
      />
      {valid ? null : (
        <p className={styles.error} id={`${formId}-error`}>
          Enter a chance from {PERCENT_MIN}% to {PERCENT_MAX}%.
        </p>
      )}
      <Chips figures={figures} text={text} onPick={change} label="Use a published figure" />
      <Readout
        label="Your forecast beside the crowd and the market"
        cells={[
          ...(p === null ? [] : [{ label: "You", display: formatProbability(p), own: true }]),
          ...figures.map((figure) => ({ label: figure.label, display: figure.display })),
        ]}
      />
      {p === null ? null : (
        <dl className={styles.preview} id={`${formId}-preview`}>
          <div>
            <dt>If YES</dt>
            <dd>{formatScore(pointLogScore(p, 2))}</dd>
          </div>
          <div>
            <dt>If NO</dt>
            <dd>{formatScore(pointLogScore(1 - p, 2))}</dd>
          </div>
        </dl>
      )}
      <p className={styles.muted}>
        The score you keep is this one averaged over the open window. Time before your first
        forecast counts as 0, the score of 50%, so an early forecast that stays right counts most.
      </p>
      <SubmitRow submit={submit} previous={previous} ready={p !== null} />
    </form>
  );
}

function ForwardEditor({
  question,
  unit,
  previous,
  notice,
}: {
  readonly question: QuestionDetail;
  readonly unit: TournamentUnitLabel;
  readonly previous: ViewerForecast | undefined;
  readonly notice: ReactNode;
}) {
  const formId = useId();
  const submit = useSubmitForecast(question.slug);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (previous?.value == null ? "" : levelText(previous.value));
  const parsed = parseNumber(text);
  const value = parsed !== null && parsed > 0 ? parsed : null;

  const companySlug =
    question.instrument?.kind === "forward" ? question.instrument.companySlug : null;
  // The last round is the listed name's anchor, read from the market API.
  const listing = useQuery({
    queryKey: queryKeys.market(companySlug ?? "none"),
    queryFn: () =>
      apiRequest<ListingDetail>(`/api/markets/${encodeURIComponent(companySlug ?? "")}`),
    enabled: companySlug !== null,
  });

  const figures: Figure[] = [];
  const pushLevel = (label: string, chipLabel: string, level: number | null) => {
    if (level === null || !Number.isFinite(level) || level <= 0) return;
    const display = formatTournamentValue(level, unit);
    figures.push({ label, chip: `${chipLabel} ${display}`, display, fill: levelText(level) });
  };
  pushLevel(
    "Crowd median",
    "Crowd",
    question.aggregate?.published === true ? question.aggregate.value : null,
  );
  pushLevel(
    "Dealer mid",
    "Dealer",
    question.instrument?.kind === "forward" && question.instrument.midUsd !== null
      ? usdInTournamentUnit(question.instrument.midUsd, unit)
      : null,
  );
  pushLevel(
    "Last round",
    "Last round",
    companySlug !== null && listing.data !== undefined
      ? usdInTournamentUnit(Number(listing.data.anchor.postMoneyUsd), unit)
      : null,
  );

  function change(next: string) {
    setDraft(next);
    submit.reset();
  }

  const inputId = `${formId}-value`;
  const suffix = tournamentUnitSuffix(unit);
  return (
    <form
      className={styles.editor}
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        if (value !== null) submit.mutate({ value });
      }}
    >
      {notice}
      <h3 className={styles.fieldHead} id={`${formId}-title`}>
        <label htmlFor={inputId}>Level in {tournamentUnitName(unit)}</label>
      </h3>
      <div className={styles.forwardField}>
        <span className={styles.inputFrame}>
          <span aria-hidden="true">$</span>
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            aria-invalid={text !== "" && value === null}
            aria-describedby={`${formId}-error ${formId}-void ${formId}-preview`}
            onChange={(event) => change(event.target.value)}
          />
          <span aria-hidden="true">{suffix}</span>
        </span>
        <p className={styles.voidNote} id={`${formId}-void`}>
          If nothing settles it by {formatTournamentDate(question.expiryAt)}, the question voids and
          nothing is scored. The rulebook lists every void condition.
        </p>
      </div>
      {text !== "" && value === null ? (
        <p className={styles.error} id={`${formId}-error`}>
          Enter a level above zero in {tournamentUnitName(unit)}.
        </p>
      ) : null}
      <Chips figures={figures} text={text} onPick={change} label="Use a published level" />
      <Readout label="Published levels" cells={figures} />
      <p className={styles.previewLine} id={`${formId}-preview`}>
        <span>Score if it settles</span>
        {FORWARD_PREVIEW.map(
          (point) => `${point.label} ${Math.round(forwardScoreAtRatio(point.ratio))}`,
        ).join(" · ")}
      </p>
      <p className={styles.muted}>
        The score you keep is this one averaged over the open window. Time before your first
        forecast counts as 0, the score of a 2× miss, so an early level that stays close counts
        most.
      </p>
      <SubmitRow submit={submit} previous={previous} ready={value !== null} />
    </form>
  );
}

/**
 * One number per question: a binary's chance of YES, or a forward's level in
 * its unit. The crowd and the market sit beside the field, and the score the
 * number would earn is shown before it is submitted.
 */
export function ForecastEditor({ question }: { readonly question: QuestionDetail }) {
  const pathname = usePathname();
  const viewerQuery = useTournamentViewer();
  const viewer = viewerQuery.data?.viewer ?? null;

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

  const previous = viewer.forecasts[question.slug];
  const notice = viewer.firstSubmission ? (
    <p className={styles.publicNotice}>
      <strong>Forecasts are public.</strong> Every forecast you submit is shown under your name on
      this page, your profile and the leaderboard, and stays in the record after you revise it.
    </p>
  ) : null;
  return question.kind === "forward" && question.unit !== null ? (
    <ForwardEditor question={question} unit={question.unit} previous={previous} notice={notice} />
  ) : (
    <BinaryEditor question={question} previous={previous} notice={notice} />
  );
}
