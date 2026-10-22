"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, type ReactNode, useState } from "react";

import { apiRequest } from "../../lib/client/api.js";
import {
  errorMessage,
  formatTournamentDateTime,
  formatTournamentValue,
  tournamentKindCaption,
  tournamentUnitName,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { useTournamentViewer } from "../../lib/client/tournament.js";
import type { AdminQuestion } from "../../lib/services/tournament/admin.js";
import styles from "./tournament-admin.module.css";

const FALLBACK = "The action did not complete.";

function useAdminAction<T>(path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: T) =>
      apiRequest<unknown>(path, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["openmarket", "tournament"] }),
  });
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children and rendered inside the label.
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

interface ActionState {
  readonly isError: boolean;
  readonly isSuccess: boolean;
  readonly error: unknown;
  readonly data: unknown;
}

function Outcome({ mutation }: { readonly mutation: ActionState }) {
  if (mutation.isError) {
    return (
      <p className={styles.error} role="alert">
        {errorMessage(mutation.error, FALLBACK)}
      </p>
    );
  }
  if (mutation.isSuccess) {
    return (
      <pre className={styles.result} role="status">
        {JSON.stringify(mutation.data, null, 2)}
      </pre>
    );
  }
  return null;
}

function CloseForm({ question }: { readonly question: AdminQuestion }) {
  const [closedAt, setClosedAt] = useState("");
  const close = useAdminAction<{ closed_at?: string }>(
    `/api/t/admin/questions/${question.slug}/close`,
  );
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        close.mutate(closedAt === "" ? {} : { closed_at: new Date(closedAt).toISOString() });
      }}
    >
      <Field label="Document's public time (blank = now, your local zone)">
        <input
          type="datetime-local"
          value={closedAt}
          onChange={(event) => setClosedAt(event.target.value)}
        />
      </Field>
      <button className={styles.inkButton} type="submit" disabled={close.isPending}>
        Close early
      </button>
      <Outcome mutation={close} />
    </form>
  );
}

/** The settling value as typed: a level above zero in the question's unit, or null. */
function parseLevel(text: string): number | null {
  const value = Number(text.replace(/[,\s]/g, ""));
  return text.trim() !== "" && Number.isFinite(value) && value > 0 ? value : null;
}

/** A binary by its outcome, a forward by its settling value; a void goes through the Void form. */
function ResolveForm({ question }: { readonly question: AdminQuestion }) {
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [value, setValue] = useState("");
  const [rung, setRung] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [note, setNote] = useState("");
  const resolve = useAdminAction<Record<string, unknown>>(
    `/api/t/admin/questions/${question.slug}/resolve`,
  );
  const unit = question.kind === "forward" ? question.unit : null;
  const level = unit === null ? null : parseLevel(value);
  const ready = unit === null || level !== null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    resolve.mutate({
      ...(unit === null ? { outcome } : { resolved_value: level }),
      rung_fired: rung === "" ? null : Number(rung),
      source_url: sourceUrl === "" ? null : sourceUrl,
      source_excerpt: excerpt === "" ? null : excerpt,
      note_md: note,
    });
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {unit === null ? (
        <Field label="Outcome">
          <select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value === "no" ? "no" : "yes")}
          >
            <option value="yes">YES</option>
            <option value="no">NO (includes nothing by expiry)</option>
          </select>
        </Field>
      ) : (
        <>
          <Field label={`Settling value after rounding, in ${tournamentUnitName(unit)}`}>
            <input
              inputMode="decimal"
              value={value}
              required
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <p className={styles.confirm}>
            Settles at: <strong>{level === null ? "—" : formatTournamentValue(level, unit)}</strong>
          </p>
        </>
      )}
      <Field label="Source rank (the rung that fired; blank if none)">
        <input inputMode="numeric" value={rung} onChange={(event) => setRung(event.target.value)} />
      </Field>
      <Field label="Source URL">
        <input
          type="url"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
        />
      </Field>
      <Field label="Source excerpt (≤ 500 characters)">
        <textarea
          maxLength={500}
          rows={2}
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
        />
      </Field>
      <Field label="Resolution note (Markdown)">
        <textarea
          rows={3}
          required
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <button
        className={styles.inkButton}
        type="submit"
        disabled={resolve.isPending || !ready || note.trim() === ""}
      >
        {question.storedStatus === "resolved" ? "Supersede resolution" : "Resolve and score"}
      </button>
      <Outcome mutation={resolve} />
    </form>
  );
}

function NoteForm({
  question,
  action,
}: {
  readonly question: AdminQuestion;
  readonly action: "void" | "notes";
}) {
  const [note, setNote] = useState("");
  const mutation = useAdminAction<{ note_md: string }>(
    `/api/t/admin/questions/${question.slug}/${action}`,
  );
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate({ note_md: note });
      }}
    >
      <Field label={action === "void" ? "Void note (Markdown)" : "Dispute record (Markdown)"}>
        <textarea
          rows={3}
          required
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <button
        className={styles.inkButton}
        type="submit"
        disabled={mutation.isPending || note.trim() === ""}
      >
        {action === "void" ? "Void question" : "Add note"}
      </button>
      <Outcome mutation={mutation} />
    </form>
  );
}

function QuestionActions({ question }: { readonly question: AdminQuestion }) {
  const open = useAdminAction<Record<string, never>>(
    `/api/t/admin/questions/${question.slug}/open`,
  );
  const inDisputeWindow =
    question.disputeWindowEndsAt !== null && Date.parse(question.disputeWindowEndsAt) > Date.now();
  return (
    <li className={styles.question}>
      <div className={styles.questionHeader}>
        <div>
          <strong>{question.title}</strong>
          <span className={styles.meta}>
            {tournamentKindCaption(question)} · {question.slug} · {question.status}
            {question.status !== question.storedStatus ? ` (stored ${question.storedStatus})` : ""}{" "}
            · {question.forecasters} forecasters · {question.forecastEvents} events
          </span>
          <span className={styles.meta}>
            Opens {formatTournamentDateTime(question.opensAt)} · window ends{" "}
            {formatTournamentDateTime(question.windowEndsAt)} · expiry{" "}
            {formatTournamentDateTime(question.expiryAt)}
          </span>
        </div>
        {question.storedStatus === "draft" ? null : (
          <Link className={styles.link} href={`/t/q/${question.slug}`}>
            View
          </Link>
        )}
      </div>
      {question.storedStatus === "draft" ? (
        <div className={styles.form}>
          <button
            className={styles.inkButton}
            type="button"
            disabled={open.isPending}
            onClick={() => open.mutate({})}
          >
            Open question
          </button>
          <Outcome mutation={open} />
        </div>
      ) : null}
      {question.status === "open" ? (
        <details>
          <summary>Close early</summary>
          <CloseForm question={question} />
        </details>
      ) : null}
      {question.status === "closed" || (question.status === "resolved" && inDisputeWindow) ? (
        <details>
          <summary>
            {question.status === "resolved" ? "Correct resolution (dispute window)" : "Resolve"}
          </summary>
          <ResolveForm question={question} />
        </details>
      ) : null}
      {question.status === "resolved" ? (
        <details>
          <summary>Record a dispute outcome</summary>
          <NoteForm question={question} action="notes" />
        </details>
      ) : null}
      {question.storedStatus !== "resolved" || inDisputeWindow ? (
        <details>
          <summary>
            {question.storedStatus === "resolved" ? "Void (dispute window)" : "Void"}
          </summary>
          <NoteForm question={question} action="void" />
        </details>
      ) : null}
    </li>
  );
}

function DraftForm() {
  const [source, setSource] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const save = useAdminAction<unknown>("/api/t/admin/questions");
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        try {
          save.mutate(JSON.parse(source) as unknown);
          setParseError(null);
        } catch {
          setParseError("The question is not valid JSON.");
        }
      }}
    >
      <Field label="Question JSON (creates a draft, or replaces a draft with the same slug)">
        <textarea
          className={styles.code}
          rows={12}
          spellCheck={false}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder='{"slug": "…", "title": "…", "kind": "forward", "unit": "USD_B", "expiry_at": "…", "opens_at": "…", "closes_at": "…", "description_md": "…", "rulebook_md": "…", "rulebook_version": 1} — or "kind": "binary" with no unit or expiry_at'
        />
      </Field>
      <button className={styles.inkButton} type="submit" disabled={save.isPending}>
        Save draft
      </button>
      {parseError === null ? null : (
        <p className={styles.error} role="alert">
          {parseError}
        </p>
      )}
      <Outcome mutation={save} />
    </form>
  );
}

function FlagForm() {
  const [handle, setHandle] = useState("");
  const [flagged, setFlagged] = useState(true);
  const [reason, setReason] = useState("");
  const flag = useAdminAction<Record<string, unknown>>("/api/t/admin/users/flag");
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        flag.mutate({ handle, flagged, ...(flagged ? { reason } : {}) });
      }}
    >
      <Field label="Handle (X handle, or ~username for a username account)">
        <input value={handle} required onChange={(event) => setHandle(event.target.value)} />
      </Field>
      <Field label="Action">
        <select
          value={flagged ? "flag" : "clear"}
          onChange={(event) => setFlagged(event.target.value === "flag")}
        >
          <option value="flag">Flag (exclude from aggregate)</option>
          <option value="clear">Clear flag</option>
        </select>
      </Field>
      {flagged ? (
        <Field label="Reason">
          <input value={reason} required onChange={(event) => setReason(event.target.value)} />
        </Field>
      ) : null}
      <button className={styles.inkButton} type="submit" disabled={flag.isPending}>
        Apply
      </button>
      <Outcome mutation={flag} />
    </form>
  );
}

function AffiliationOverrideForm() {
  const [handle, setHandle] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const update = useAdminAction<Record<string, unknown>>("/api/t/admin/users/affiliation");
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ handle, affiliation: affiliation.trim() === "" ? null : affiliation });
      }}
    >
      <Field label="Handle (X handle, or ~username for a username account)">
        <input value={handle} required onChange={(event) => setHandle(event.target.value)} />
      </Field>
      <Field label="Affiliation (blank clears it)">
        <input
          value={affiliation}
          maxLength={60}
          onChange={(event) => setAffiliation(event.target.value)}
        />
      </Field>
      <button className={styles.inkButton} type="submit" disabled={update.isPending}>
        Set affiliation
      </button>
      <Outcome mutation={update} />
    </form>
  );
}

export function TournamentAdmin() {
  const viewer = useTournamentViewer();
  const isAdmin = viewer.data?.isAdmin === true;
  const questions = useQuery({
    queryKey: queryKeys.tournamentAdmin,
    queryFn: () =>
      apiRequest<{ questions: AdminQuestion[] }>("/api/t/admin/questions").then(
        (body) => body.questions,
      ),
    enabled: isAdmin,
  });

  if (viewer.isPending) {
    return <div className={styles.skeleton} role="status" aria-label="Checking admin access" />;
  }
  if (!isAdmin) {
    return (
      <div className={styles.statePanel}>
        <strong>Tournament admin only.</strong>
        <p>
          Admins are an allowlist of X accounts in the deployment's configuration. Sign in with an
          allowlisted account to manage questions.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1>Tournament admin</h1>
      <section className={styles.module} aria-labelledby="admin-questions">
        <h2 className={styles.tab} id="admin-questions">
          Questions
        </h2>
        {questions.isPending ? (
          <div className={styles.skeleton} />
        ) : questions.isError ? (
          <p className={styles.error}>{errorMessage(questions.error, FALLBACK)}</p>
        ) : questions.data.length === 0 ? (
          <p className={styles.meta}>No questions yet. Save a draft below.</p>
        ) : (
          <ul className={styles.questions}>
            {questions.data.map((question) => (
              <QuestionActions key={question.slug} question={question} />
            ))}
          </ul>
        )}
      </section>
      <section className={styles.module} aria-labelledby="admin-draft">
        <h2 className={styles.tab} id="admin-draft">
          Draft a question
        </h2>
        <DraftForm />
      </section>
      <section className={styles.module} aria-labelledby="admin-flag">
        <h2 className={styles.tab} id="admin-flag">
          Flag an account
        </h2>
        <FlagForm />
      </section>
      <section className={styles.module} aria-labelledby="admin-affiliation">
        <h2 className={styles.tab} id="admin-affiliation">
          Override an affiliation
        </h2>
        <AffiliationOverrideForm />
      </section>
    </div>
  );
}
