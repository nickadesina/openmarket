"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, type ReactNode, useState } from "react";

import { apiRequest } from "../../lib/client/api.js";
import { errorMessage, formatTournamentDateTime } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { useTournamentViewer } from "../../lib/client/tournament.js";
import {
  BucketError,
  bucketIndexForValue,
  floorIndex,
} from "../../lib/engine/tournament/buckets.js";
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

function computedBucket(question: AdminQuestion, value: string): number | null {
  if (question.unit === "bool") return null;
  if (value.trim() === "") return floorIndex(question.buckets);
  try {
    return bucketIndexForValue(question.buckets, Number(value));
  } catch (error) {
    if (error instanceof BucketError) return null;
    throw error;
  }
}

function ResolveForm({ question }: { readonly question: AdminQuestion }) {
  const [value, setValue] = useState("");
  const [binaryIndex, setBinaryIndex] = useState(0);
  const [rung, setRung] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [note, setNote] = useState("");
  const resolve = useAdminAction<Record<string, unknown>>(
    `/api/t/admin/questions/${question.slug}/resolve`,
  );
  const winning = question.unit === "bool" ? binaryIndex : computedBucket(question, value);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (winning === null) return;
    resolve.mutate({
      resolved_value: question.unit === "bool" || value.trim() === "" ? null : Number(value),
      winning_bucket_index: winning,
      rung_fired: rung === "" ? null : Number(rung),
      source_url: sourceUrl === "" ? null : sourceUrl,
      source_excerpt: excerpt === "" ? null : excerpt,
      note_md: note,
    });
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {question.unit === "bool" ? (
        <Field label="Outcome">
          <select
            value={binaryIndex}
            onChange={(event) => setBinaryIndex(Number(event.target.value))}
          >
            {question.buckets.map((bucket) => (
              <option key={bucket.index} value={bucket.index}>
                {bucket.label}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="Resolved value after rounding (blank = floor, only after expiry)">
          <input
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
      )}
      <p className={styles.confirm}>
        Winning bucket:{" "}
        <strong>
          {winning === null ? "—" : `${winning} · ${question.buckets[winning]?.label}`}
        </strong>
      </p>
      {question.unit === "bool" ? null : (
        <Field label="Rung fired">
          <input
            inputMode="numeric"
            value={rung}
            onChange={(event) => setRung(event.target.value)}
          />
        </Field>
      )}
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
        disabled={resolve.isPending || winning === null || note.trim() === ""}
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
            {question.slug} · {question.status}
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
      {question.storedStatus !== "resolved" && question.storedStatus !== "voided" ? (
        <details>
          <summary>Void</summary>
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
          placeholder='{"slug": "…", "title": "…", "unit": "USD_B", "buckets": {"edges": [66, 70], "floor_label": "…"}, …}'
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
      <Field label="X handle">
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
    </div>
  );
}
