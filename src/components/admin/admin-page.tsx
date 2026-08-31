"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { SettlementResult } from "../../lib/services/settle-market.js";
import type { SeedMarketOutcome } from "../../lib/services/seed-market.js";
import styles from "./admin-page.module.css";

type AdminState = "unknown" | "authenticated" | "required";
type MetricKind = "valuation_median" | "yes_probability";

interface SeedResponse {
  readonly outcome: SeedMarketOutcome;
  readonly market_id: string;
  readonly slug: string;
  readonly status: "open" | "settled";
  readonly metric_kind: MetricKind;
  readonly current_metric: number;
  readonly created_at: string;
}

interface LoginResponse {
  readonly authenticated: boolean;
}

interface SettlementDraft {
  readonly slug: string;
  readonly settled_value_usd: string;
  readonly source_url: string;
  readonly source_description: string;
}

interface SettlementRequest extends SettlementDraft {
  readonly confirm_slug: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The operation could not be completed.";
}

function isAdminRequired(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "ADMIN_REQUIRED";
}

function Field({
  label,
  name,
  children,
  support,
}: {
  readonly label: string;
  readonly name: string;
  readonly children: React.ReactNode;
  readonly support?: string;
}): React.JSX.Element {
  return (
    <label className={styles.field} htmlFor={name}>
      <span>{label}</span>
      {children}
      {support === undefined ? null : <small>{support}</small>}
    </label>
  );
}

function AdminLogin({ onAuthenticated }: { readonly onAuthenticated: () => void }): React.JSX.Element {
  const [passphrase, setPassphrase] = useState("");
  const loginMutation = useMutation({
    mutationFn: () => apiRequest<LoginResponse>("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ passphrase }),
    }),
    onSuccess: () => {
      setPassphrase("");
      onAuthenticated();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (passphrase.length > 0) loginMutation.mutate();
  }

  return (
    <section className={styles.loginPanel} aria-labelledby="admin-login-heading">
      <div>
        <p className={styles.sectionLabel}>Authentication</p>
        <h2 id="admin-login-heading">Admin session</h2>
        <p>Passphrase verification sets a separate signed, HTTP-only admin cookie.</p>
      </div>
      <form onSubmit={submit} className={styles.loginForm}>
        <Field label="Admin passphrase" name="admin-passphrase">
          <input
            id="admin-passphrase"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            disabled={loginMutation.isPending}
            required
          />
        </Field>
        <button type="submit" className={styles.primaryButton} disabled={passphrase.length === 0 || loginMutation.isPending}>
          {loginMutation.isPending ? "Verifying…" : "Start admin session"}
        </button>
      </form>
      {loginMutation.isError ? <p className={styles.inlineError} role="alert">{errorMessage(loginMutation.error)}</p> : null}
    </section>
  );
}

function SeedForm({ onAdminRequired }: { readonly onAdminRequired: () => void }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [metricKind, setMetricKind] = useState<MetricKind>("valuation_median");
  const [result, setResult] = useState<SeedResponse | null>(null);

  const seedMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest<SeedResponse>("/api/admin/seed", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    onSuccess: async (nextResult) => {
      setResult(nextResult);
      await queryClient.invalidateQueries({ queryKey: queryKeys.markets });
    },
    onError: (error) => {
      if (isAdminRequired(error)) onAdminRequired();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setResult(null);
    const data = new FormData(event.currentTarget);
    const shared = {
      name: String(data.get("name")),
      slug: String(data.get("slug")),
      logo_path: String(data.get("logo_path")),
      b: Number(data.get("b")),
      metric_kind: metricKind,
    };
    const body = metricKind === "valuation_median"
      ? {
          ...shared,
          anchor_valuation_usd: String(data.get("anchor_valuation_usd")),
          anchor_date: String(data.get("anchor_date")),
          anchor_description: String(data.get("anchor_description")),
          sigma: Number(data.get("sigma")),
        }
      : {
          ...shared,
          yes_probability: Number(data.get("yes_probability")),
        };
    seedMutation.mutate(body);
  }

  return (
    <section className={styles.operation} aria-labelledby="seed-heading">
      <header className={styles.operationHeader}>
        <div>
          <p className={styles.sectionLabel}>Market setup</p>
          <h2 id="seed-heading">Seed or restore a market</h2>
          <p>Pristine markets can be reseeded. Markets with trades cannot be replaced.</p>
        </div>
      </header>

      <div className={styles.cautionNote}>
        <strong>Source verification is external.</strong>
        <span>Enter only an independently verified public anchor. This form does not verify a draft anchor or source claim.</span>
      </div>

      <form onSubmit={submit} className={styles.form}>
        <fieldset className={styles.segmentedField}>
          <legend>Market metric</legend>
          <div>
            <label>
              <input type="radio" name="metric_kind" value="valuation_median" checked={metricKind === "valuation_median"} onChange={() => setMetricKind("valuation_median")} />
              <span>Valuation median</span>
            </label>
            <label>
              <input type="radio" name="metric_kind" value="yes_probability" checked={metricKind === "yes_probability"} onChange={() => setMetricKind("yes_probability")} />
              <span>Binary probability</span>
            </label>
          </div>
        </fieldset>

        <div className={styles.twoColumns}>
          <Field label="Company name" name="seed-name"><input id="seed-name" name="name" required maxLength={200} /></Field>
          <Field label="Company slug" name="seed-slug" support="Lowercase letters, numbers, and hyphens."><input id="seed-slug" name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /></Field>
        </div>
        <div className={styles.twoColumns}>
          <Field label="Logo path" name="seed-logo"><input id="seed-logo" name="logo_path" required placeholder="/logos/company.svg" /></Field>
          <Field label="Liquidity parameter (b)" name="seed-b"><input id="seed-b" name="b" type="number" required min="0.000001" step="any" inputMode="decimal" /></Field>
        </div>

        {metricKind === "valuation_median" ? (
          <>
            <div className={styles.twoColumns}>
              <Field label="Verified anchor value (USD)" name="seed-anchor"><input id="seed-anchor" name="anchor_valuation_usd" required inputMode="decimal" placeholder="0.00" /></Field>
              <Field label="Anchor date" name="seed-date"><input id="seed-date" name="anchor_date" type="date" required /></Field>
            </div>
            <Field label="Anchor description" name="seed-description" support="Name the public event or report behind the anchor.">
              <textarea id="seed-description" name="anchor_description" required maxLength={1000} rows={3} />
            </Field>
            <Field label="Distribution sigma" name="seed-sigma"><input id="seed-sigma" name="sigma" type="number" required min="0.000001" step="any" inputMode="decimal" /></Field>
          </>
        ) : (
          <Field label="Initial YES probability" name="seed-probability" support="Enter a value greater than 0 and less than 1.">
            <input id="seed-probability" name="yes_probability" type="number" required min="0.000001" max="0.999999" step="any" inputMode="decimal" />
          </Field>
        )}

        <div className={styles.formActions}>
          <button type="submit" className={styles.primaryButton} disabled={seedMutation.isPending}>
            {seedMutation.isPending ? "Seeding market…" : "Seed market"}
          </button>
        </div>
      </form>

      {seedMutation.isError ? <p className={styles.inlineError} role="alert">{errorMessage(seedMutation.error)}</p> : null}
      {result !== null ? (
        <div className={styles.successNotice} role="status">
          <strong>Market {result.outcome}</strong>
          <span>{result.slug} is {result.status}. Market ID: {result.market_id}</span>
        </div>
      ) : null}
    </section>
  );
}

function SettlementForm({ onAdminRequired }: { readonly onAdminRequired: () => void }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [review, setReview] = useState<SettlementDraft | null>(null);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [result, setResult] = useState<SettlementResult | null>(null);

  const settlementMutation = useMutation({
    mutationFn: (body: SettlementRequest) => apiRequest<SettlementResult>("/api/admin/settle", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    onSuccess: async (nextResult) => {
      setResult(nextResult);
      setReview(null);
      setConfirmSlug("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
    },
    onError: (error) => {
      if (isAdminRequired(error)) onAdminRequired();
    },
  });

  function beginReview(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setResult(null);
    const data = new FormData(event.currentTarget);
    setReview({
      slug: String(data.get("slug")).trim(),
      settled_value_usd: String(data.get("settled_value_usd")).trim(),
      source_url: String(data.get("source_url")).trim(),
      source_description: String(data.get("source_description")).trim(),
    });
    setConfirmSlug("");
  }

  const exactMatch = review !== null && confirmSlug === review.slug;

  return (
    <section className={styles.operation} aria-labelledby="settlement-heading">
      <header className={styles.operationHeader}>
        <div>
          <p className={styles.sectionLabel}>Resolution</p>
          <h2 id="settlement-heading">Settle a market</h2>
          <p>Settlement pays the winning bucket, clears holdings, and permanently closes the market.</p>
        </div>
        <span className={styles.irreversibleBadge}>Irreversible</span>
      </header>

      {review === null ? (
        <form onSubmit={beginReview} className={styles.form}>
          <div className={styles.twoColumns}>
            <Field label="Market slug" name="settle-slug"><input id="settle-slug" name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /></Field>
            <Field label="Settlement value (USD)" name="settle-value"><input id="settle-value" name="settled_value_usd" required inputMode="decimal" placeholder="0.00" /></Field>
          </div>
          <Field label="Public source URL" name="settle-source" support="HTTP or HTTPS source documenting the resolution value.">
            <input id="settle-source" name="source_url" type="url" required placeholder="https://" />
          </Field>
          <Field label="Source description" name="settle-description" support="Identify the report, announcement, or filing that establishes the outcome.">
            <textarea id="settle-description" name="source_description" required maxLength={1000} rows={3} />
          </Field>
          <div className={styles.formActions}>
            <button type="submit" className={styles.secondaryButton}>Review settlement</button>
          </div>
        </form>
      ) : (
        <div className={styles.reviewPanel}>
          <h3>Review the permanent outcome</h3>
          <dl>
            <div><dt>Market</dt><dd>{review.slug}</dd></div>
            <div><dt>Settlement value</dt><dd>${review.settled_value_usd}</dd></div>
            <div><dt>Source</dt><dd><a href={review.source_url} target="_blank" rel="noreferrer">Open public source</a></dd></div>
            <div><dt>Description</dt><dd>{review.source_description}</dd></div>
          </dl>
          <p className={styles.irreversibleCopy}>Submitting will credit every eligible account and close this market. It cannot be reopened or edited.</p>
          <Field label={`Retype “${review.slug}” exactly to confirm`} name="confirm-slug">
            <input
              id="confirm-slug"
              value={confirmSlug}
              onChange={(event) => setConfirmSlug(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={confirmSlug.length > 0 && !exactMatch}
              disabled={settlementMutation.isPending}
            />
          </Field>
          {confirmSlug.length > 0 && !exactMatch ? <p className={styles.inlineError} role="alert">The confirmation must exactly match the market slug.</p> : null}
          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => setReview(null)} disabled={settlementMutation.isPending}>Edit details</button>
            <button
              type="button"
              className={styles.dangerButton}
              disabled={!exactMatch || settlementMutation.isPending}
              onClick={() => {
                if (review !== null && exactMatch) settlementMutation.mutate({ ...review, confirm_slug: confirmSlug });
              }}
            >
              {settlementMutation.isPending ? "Settling market…" : "Settle market permanently"}
            </button>
          </div>
        </div>
      )}

      {settlementMutation.isError ? <p className={styles.inlineError} role="alert">{errorMessage(settlementMutation.error)}</p> : null}
      {result !== null ? (
        <div className={styles.successNotice} role="status">
          <strong>{result.slug} settled</strong>
          <span>{result.credited_users} accounts credited, total payout ${(Number(result.total_payout_cents) / 100).toFixed(2)}.</span>
        </div>
      ) : null}
    </section>
  );
}

export function AdminPage(): React.JSX.Element {
  const [adminState, setAdminState] = useState<AdminState>("unknown");

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.sectionLabel}>Restricted operations</p>
        <h1>Market administration</h1>
        <p>Seed verified market inputs and record final outcomes. Every mutation is validated by the server.</p>
      </header>

      {adminState === "authenticated" ? (
        <>
          <div className={styles.sessionNotice} role="status">
            <span>Admin session authenticated</span>
            <span>Authorization is checked again for each operation.</span>
          </div>
          <div className={styles.operations}>
            <SeedForm onAdminRequired={() => setAdminState("required")} />
            <SettlementForm onAdminRequired={() => setAdminState("required")} />
          </div>
        </>
      ) : (
        <>
          <AdminLogin onAuthenticated={() => setAdminState("authenticated")} />
          {adminState === "required" ? (
            <p className={styles.authRequired} role="alert">Your admin session is missing or expired. Verify the passphrase to restore access.</p>
          ) : null}
          <p className={styles.gatedExplanation}>Seed and settlement controls are hidden until this browser session is authenticated.</p>
        </>
      )}
    </div>
  );
}
