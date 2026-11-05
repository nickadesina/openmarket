/**
 * The daily ingest job (`GET /api/cron/ingest`): each EDGAR source, run
 * incrementally from a week before its last `ok` run started (full-text
 * search indexes a filing a day or more after it is filed, and reruns are
 * idempotent), inside the route's 300 s limit. A run that reaches the
 * deadline stops before its next document and records `failed` with how
 * many it left; the next run starts from the same last `ok` run and skips
 * what is already stored.
 */
import type { Kysely } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type { Database, IndexSourceClass } from "../../db/schema.js";
import { createSecClient, type SecClient } from "../../ingest/fetch/sec.js";
import { type IngestNportReport, ingestNport } from "./ingest-nport.js";
import { lastOkRunStartedAt } from "./ingest-runs.js";

/** Where a source's history starts: N-PORT-P filings became public in 2019. */
export const INGEST_HISTORY_START = "2019-01-01";
export const INCREMENTAL_OVERLAP_DAYS = 7;

/** The route's limit (Vercel `maxDuration`) and the margin the job leaves before it. */
export const CRON_EXECUTION_SECONDS = 300;
export const CRON_STOP_MARGIN_SECONDS = 45;

/** The EDGAR sources the job runs, in order. */
export const SCHEDULED_SOURCES = ["nport"] as const satisfies readonly IndexSourceClass[];

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export async function incrementalSince(
  db: Kysely<Database>,
  sourceClass: IndexSourceClass,
): Promise<string> {
  const lastOk = await lastOkRunStartedAt(db, sourceClass);
  if (lastOk === null) return INGEST_HISTORY_START;
  return isoDate(new Date(lastOk.getTime() - INCREMENTAL_OVERLAP_DAYS * 86_400_000));
}

export interface ScheduledIngestReport {
  readonly sources: readonly {
    readonly source: IndexSourceClass;
    readonly since: string;
    readonly report: IngestNportReport;
  }[];
}

/** The SEC client the job uses; without `SEC_USER_AGENT` the job cannot run. */
export function scheduledSecClient(): SecClient {
  try {
    return createSecClient();
  } catch {
    throw new ServiceError(
      "INGEST_UNAVAILABLE",
      "The ingest job needs SEC_USER_AGENT (a name and a contact) to call EDGAR.",
    );
  }
}

export async function runScheduledIngest(
  db: Kysely<Database>,
  options: {
    readonly startedAt: Date;
    readonly client?: SecClient;
    readonly now?: () => Date;
  },
): Promise<ScheduledIngestReport> {
  const client = options.client ?? scheduledSecClient();
  const now = options.now ?? (() => new Date());
  const deadlineMs =
    options.startedAt.getTime() + (CRON_EXECUTION_SECONDS - CRON_STOP_MARGIN_SECONDS) * 1_000;
  const sources: ScheduledIngestReport["sources"][number][] = [];
  for (const source of SCHEDULED_SOURCES) {
    const since = await incrementalSince(db, source);
    const report = await ingestNport(db, client, {
      since,
      until: isoDate(now()),
      deadlineMs,
      now,
    });
    sources.push({ source, since, report });
  }
  return { sources };
}

/** The job's response: each source's run, without the per-document lists. */
export function scheduledIngestSummary(report: ScheduledIngestReport) {
  return {
    sources: report.sources.map(({ source, since, report: run }) => ({
      source,
      since,
      run_id: run.runId,
      status: run.status,
      error: run.error,
      candidates: run.candidates,
      documents_seen: run.documentsSeen,
      documents_new: run.documentsNew,
      documents_skipped: run.documentsSkipped,
      marks_new: run.marksNew,
      superseded_new: run.supersededNew,
      unread: run.failures.length,
    })),
  };
}
