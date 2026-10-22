"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";

import { ApiClientError, apiRequest } from "../../lib/client/api.js";
import {
  errorMessage,
  formatCents,
  formatDateTime,
  formatDuration,
  formatHours,
} from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { signInHref, useTournamentViewer } from "../../lib/client/tournament.js";
import type {
  AdminPendingPromotion,
  DealerAdminPayload,
} from "../../lib/services/dealer/get-dealer-admin.js";
import styles from "./admin-dealer-page.module.css";

/** The payload as JSON carries it: every Date an ISO string. */
type Wire<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? readonly Wire<U>[]
    : T extends object
      ? { readonly [K in keyof T]: Wire<T[K]> }
      : T;

type Payload = Wire<DealerAdminPayload>;

const REFRESH_MS = 60_000;

const PENDING_REASONS: Readonly<Record<AdminPendingPromotion["reason"], string>> = {
  rank_needs_review: "Source rank 3–4: needs review",
  confidence_below_high: "Below high confidence",
  no_source_url: "No source URL",
};

function when(value: string | null): string {
  return value === null ? "—" : formatDateTime(value);
}

/** Dealer-side cash: a sign and a word, never color alone (DESIGN.md → Arrow-and-Word). */
function Pnl({ cents }: { readonly cents: string }) {
  const value = BigInt(cents);
  if (value === 0n) return <span className={styles.flat}>{formatCents("0")}</span>;
  const magnitude = formatCents((value < 0n ? -value : value).toString());
  return value > 0n ? (
    <span className={styles.gain}>Gain {magnitude}</span>
  ) : (
    <span className={styles.loss}>Loss {magnitude}</span>
  );
}

function Module({
  id,
  label,
  title,
  note,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly note?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className={styles.module} aria-labelledby={id}>
      <header className={styles.moduleHeader}>
        <p className={styles.sectionLabel}>{label}</p>
        <h2 id={id}>{title}</h2>
        {note === undefined ? null : <p>{note}</p>}
      </header>
      {children}
    </section>
  );
}

function Empty({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      <p>{children}</p>
    </div>
  );
}

function PnlModule({ pnl }: { readonly pnl: Payload["pnl"] }) {
  return (
    <Module
      id="dealer-pnl"
      label="Books"
      title="Dealer P&L"
      note="Per listing and epoch, from the dealer's side. Bound is Q·κ per forward and b·ln(1/p_floor) per binary."
    >
      {pnl.length === 0 ? (
        <Empty title="No books yet.">The dealer job lists a binary and a forward per name.</Empty>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Instrument</th>
                <th scope="col">State</th>
                <th scope="col" className={styles.figure}>
                  Realised
                </th>
                <th scope="col" className={styles.figure}>
                  Unrealised
                </th>
                <th scope="col" className={styles.figure}>
                  Collateral
                </th>
                <th scope="col" className={styles.figure}>
                  Bound
                </th>
              </tr>
            </thead>
            {pnl.map((listing) => (
              <tbody key={listing.listing_id}>
                {listing.rows.map((row) => (
                  <tr key={row.instrument_id}>
                    <td>{listing.company}</td>
                    <td>
                      {row.kind} · epoch {row.epoch}
                    </td>
                    <td>{row.state}</td>
                    <td className={styles.figure}>
                      <Pnl cents={row.realised_cents} />
                    </td>
                    <td className={styles.figure}>
                      <Pnl cents={row.unrealised_cents} />
                    </td>
                    <td className={styles.figure}>{formatCents(row.open_collateral_cents)}</td>
                    <td className={styles.figure}>{formatCents(row.bound_cents)}</td>
                  </tr>
                ))}
                <tr className={styles.totalRow}>
                  <th scope="row" colSpan={3}>
                    {listing.company} total (bound: live instruments)
                  </th>
                  <td className={styles.figure}>
                    <Pnl cents={listing.totals.realised_cents} />
                  </td>
                  <td className={styles.figure}>
                    <Pnl cents={listing.totals.unrealised_cents} />
                  </td>
                  <td className={styles.figure}>
                    {formatCents(listing.totals.open_collateral_cents)}
                  </td>
                  <td className={styles.figure}>{formatCents(listing.totals.live_bound_cents)}</td>
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      )}
    </Module>
  );
}

function InstrumentsModule({ data }: { readonly data: Payload }) {
  const overHold = new Map(
    data.health.widened_over_hold.instruments.map((row) => [row.instrument_id, row]),
  );
  return (
    <Module
      id="dealer-instruments"
      label="Quoting"
      title="Live instruments"
      note={`A flag widens a forward until a newer mid or ${data.health.widened_over_hold.hold_hours} h pass.`}
    >
      {overHold.size > 0 ? (
        <p className={styles.warning} role="alert">
          {overHold.size} {overHold.size === 1 ? "instrument has" : "instruments have"} been widened
          longer than the {data.health.widened_over_hold.hold_hours} h hold.
        </p>
      ) : null}
      {data.instruments.length === 0 ? (
        <Empty title="No live instruments.">The dealer job has not listed any yet.</Empty>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Instrument</th>
                <th scope="col">State</th>
                <th scope="col">Expires</th>
                <th scope="col">Widened until</th>
              </tr>
            </thead>
            <tbody>
              {data.instruments.map((instrument) => {
                const stuck = overHold.get(instrument.id);
                return (
                  <tr key={instrument.id}>
                    <td>{instrument.company}</td>
                    <td>
                      {instrument.kind} · epoch {instrument.epoch}
                    </td>
                    <td>
                      {instrument.state}
                      {stuck === undefined ? null : (
                        <span className={styles.warningText}>
                          {" "}
                          · widened {formatHours(stuck.hours_widened)}
                        </span>
                      )}
                    </td>
                    <td>{formatDateTime(instrument.expires_at)}</td>
                    <td>{when(instrument.widened_until)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Module>
  );
}

function RunsModule({ cronRuns }: { readonly cronRuns: Payload["cron_runs"] }) {
  return (
    <Module
      id="dealer-runs"
      label="Schedule"
      title="Recent runs"
      note="The last ten firings of each scheduled job, newest first."
    >
      <div className={styles.jobs}>
        {cronRuns.map(({ job, runs }) => (
          <div key={job} className={styles.job}>
            <h3>{job}</h3>
            {runs.length === 0 ? (
              <p className={styles.muted}>No {job} runs yet.</p>
            ) : (
              <div className={styles.scroller}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Started</th>
                      <th scope="col">Status</th>
                      <th scope="col" className={styles.figure}>
                        Took
                      </th>
                      <th scope="col">Run id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.run_id}>
                        <td>{formatDateTime(run.started_at)}</td>
                        <td>
                          {run.status}
                          {run.error === null ? null : (
                            <span className={styles.errorText}> · {run.error}</span>
                          )}
                        </td>
                        <td className={styles.figure}>
                          {run.duration_ms === null ? "—" : formatDuration(run.duration_ms)}
                        </td>
                        <td className={styles.code}>{run.run_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </Module>
  );
}

function QueueModule({ queue }: { readonly queue: Payload["resolution_queue"] }) {
  return (
    <Module
      id="dealer-queue"
      label="Settlement"
      title="Resolution queue"
      note={
        queue.run_id === null
          ? "Promotions the settle job could not make on its own. Read-only for now."
          : `From settle run ${queue.run_id}, finished ${when(queue.finished_at)}. Read-only for now.`
      }
    >
      {queue.run_id === null ? (
        <Empty title="The settle job has not run yet.">
          Its first run reports any release or S-1 it cannot promote to a print.
        </Empty>
      ) : queue.pending.length === 0 ? (
        <Empty title="No promotions waiting for review.">
          Rank 1–2 releases at high confidence settle without review.
        </Empty>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Flag</th>
                <th scope="col" className={styles.figure}>
                  Rank
                </th>
                <th scope="col">Why it waits</th>
                <th scope="col">Observed</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {queue.pending.map((flag) => (
                <tr key={flag.flag_id}>
                  <td>{flag.company}</td>
                  <td>
                    {flag.kind} · {flag.confidence}
                    {flag.promoted_since ? (
                      <span className={styles.muted}> · promoted since</span>
                    ) : null}
                  </td>
                  <td className={styles.figure}>{flag.source_rank ?? "—"}</td>
                  <td>{PENDING_REASONS[flag.reason]}</td>
                  <td>{when(flag.observed_at)}</td>
                  <td>
                    {flag.source_url === null ? (
                      "—"
                    ) : (
                      <a className={styles.link} href={flag.source_url} rel="noreferrer">
                        Source
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Module>
  );
}

function SourcesModule({ sources }: { readonly sources: Payload["sources"] }) {
  return (
    <Module
      id="dealer-sources"
      label="Ingest"
      title="Source health"
      note="Each evidence source's last success and last error, as ingest records them."
    >
      {sources.length === 0 ? (
        <Empty title="No sources reporting yet.">
          Ingest writes one row per source when it runs; this table fills when it lands.
        </Empty>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Last success</th>
                <th scope="col">Last error</th>
                <th scope="col">Error</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.source}>
                  <td>{source.source}</td>
                  <td>{when(source.last_success_at)}</td>
                  <td>{when(source.last_error_at)}</td>
                  <td>{source.last_error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Module>
  );
}

function DealerOperations({ onAdminRequired }: { readonly onAdminRequired: () => void }) {
  const query = useQuery({
    queryKey: queryKeys.adminDealer,
    queryFn: async () => {
      try {
        return await apiRequest<Payload>("/api/admin/dealer");
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "ADMIN_REQUIRED") onAdminRequired();
        throw error;
      }
    },
    refetchInterval: REFRESH_MS,
    retry: false,
  });

  if (query.isPending) {
    return (
      <div className={styles.operations} aria-busy="true">
        <p role="status">Loading dealer operations…</p>
        <span className={styles.skeleton} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Dealer operations could not be loaded.</p>
        <p role="alert">{errorMessage(query.error, "The request failed.")}</p>
        <button
          type="button"
          className={styles.retry}
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          Retry
        </button>
      </div>
    );
  }
  const data = query.data;
  return (
    <div className={styles.operations}>
      <p className={styles.asOf}>As of {formatDateTime(data.as_of)}; refreshes every minute.</p>
      <PnlModule pnl={data.pnl} />
      <InstrumentsModule data={data} />
      <QueueModule queue={data.resolution_queue} />
      <RunsModule cronRuns={data.cron_runs} />
      <SourcesModule sources={data.sources} />
    </div>
  );
}

/** Admin is the tournament allowlist; the API re-checks it on every read. */
export function AdminDealerPage() {
  const viewer = useTournamentViewer();
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.sectionLabel}>Restricted operations</p>
        <h1>Dealer operations</h1>
        <p>
          The house's books, scheduled jobs, settlement queue and evidence sources. Read-only.{" "}
          <Link className={styles.link} href="/admin">
            Back to administration
          </Link>
        </p>
      </header>
      {viewer.isPending ? (
        <p role="status">Checking admin access…</p>
      ) : viewer.data?.isAdmin === true ? (
        <DealerOperations onAdminRequired={() => void viewer.refetch()} />
      ) : (
        <section className={styles.gatePanel} aria-labelledby="dealer-gate-heading">
          <div>
            <h2 id="dealer-gate-heading">Admin only.</h2>
            <p>
              Admins are an allowlist of accounts in the deployment's configuration. Sign in with an
              allowlisted account to see dealer operations.
            </p>
          </div>
          {viewer.data?.viewer == null ? (
            <Link className={styles.primaryButton} href={signInHref("/admin/dealer")}>
              Sign in
            </Link>
          ) : null}
        </section>
      )}
    </div>
  );
}
