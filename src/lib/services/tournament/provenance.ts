import type { Kysely } from "kysely";
import { sql } from "kysely";

import { ServiceError } from "../../api/errors.js";
import type { Database } from "../../db/schema.js";
import { forecastCanonical } from "../../engine/tournament/forecast.js";
import { explorerUrl, memoStatus, postMemo, type SolanaConfig } from "../../solana/memo.js";
import { identitiesFor } from "./identities.js";
import { buildMerkleTree, merkleRootFromPath } from "./merkle.js";
import { type PublicIdentity, toForecastPoint, toNumbers } from "./records.js";
import { forecastEventHash } from "./submit-forecast.js";

/** An hour is batched only once it has been over this long, so late commits land first. */
export const BATCH_GRACE_MS = 5 * 60 * 1000;
/** A posted memo not seen on chain after this long is posted again with a fresh blockhash. */
export const REPOST_AFTER_MS = 3 * 60 * 1000;

export function provenanceMemo(hourStart: Date, root: string, leafCount: number): string {
  return `openmarket.tournament.v1 ${hourStart.toISOString()} ${root} ${leafCount}`;
}

export interface CreatedBatch {
  readonly hourStart: string;
  readonly root: string;
  readonly leafCount: number;
}

/**
 * Commits every completed hour that holds unbatched forecast events: one
 * Merkle root over the hour's event hashes, ordered by submission time then
 * id, with each event's path stored beside it.
 */
export async function batchCompletedHours(db: Kysely<Database>): Promise<CreatedBatch[]> {
  const hours = await db
    .selectFrom("tournament_forecast_events as events")
    .select(sql<Date>`date_trunc('hour', events.submitted_at)`.as("hour_start"))
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("tournament_provenance_leaves")
            .select("event_id")
            .whereRef("tournament_provenance_leaves.event_id", "=", "events.id"),
        ),
      ),
    )
    .where(
      sql<boolean>`date_trunc('hour', events.submitted_at) + interval '1 hour' <= clock_timestamp() - ${`${BATCH_GRACE_MS} milliseconds`}::interval`,
    )
    .groupBy(sql`date_trunc('hour', events.submitted_at)`)
    .orderBy("hour_start")
    .execute();

  const created: CreatedBatch[] = [];
  for (const { hour_start: hourStart } of hours) {
    const batch = await db.transaction().execute(async (transaction) => {
      const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
      // Serialize batchers on the hour; a second one finds the batch and stops.
      await sql`select pg_advisory_xact_lock(hashtext('tournament_provenance'), ${hourStart.getTime() / 1000 / 3600}::int)`.execute(
        transaction,
      );
      const existing = await transaction
        .selectFrom("tournament_provenance_batches")
        .select("id")
        .where("hour_start", "=", hourStart)
        .executeTakeFirst();
      if (existing !== undefined) return null;

      const events = await transaction
        .selectFrom("tournament_forecast_events")
        .select(["id", "event_hash"])
        .where("submitted_at", ">=", hourStart)
        .where("submitted_at", "<", hourEnd)
        .orderBy("submitted_at")
        .orderBy("id")
        .execute();
      const tree = buildMerkleTree(events.map((event) => event.event_hash));
      const inserted = await transaction
        .insertInto("tournament_provenance_batches")
        .values({
          hour_start: hourStart,
          root: tree.root,
          leaf_count: events.length,
          memo: provenanceMemo(hourStart, tree.root, events.length),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("tournament_provenance_leaves")
        .values(
          events.map((event, index) => ({
            event_id: event.id,
            batch_id: inserted.id,
            leaf_index: index,
            path: tree.paths[index]!,
          })),
        )
        .execute();
      return { hourStart: hourStart.toISOString(), root: tree.root, leafCount: events.length };
    });
    if (batch !== null) created.push(batch);
  }
  return created;
}

export interface PostingReport {
  readonly posted: string[];
  readonly confirmed: string[];
  readonly waiting: string[];
  readonly errors: { readonly hourStart: string; readonly message: string }[];
}

/**
 * Moves every unconfirmed batch one step: post it, confirm it, or post it
 * again when an earlier memo failed or never landed. A failure on one
 * batch is reported and the next run retries it.
 */
export async function postPendingBatches(
  db: Kysely<Database>,
  config: SolanaConfig,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<PostingReport> {
  const report: PostingReport = { posted: [], confirmed: [], waiting: [], errors: [] };
  const pending = await db
    .selectFrom("tournament_provenance_batches")
    .selectAll()
    .where("confirmed_at", "is", null)
    .orderBy("hour_start")
    .execute();

  for (const batch of pending) {
    const hour = batch.hour_start.toISOString();
    try {
      if (batch.tx_signature !== null && batch.posted_at !== null) {
        const status = await memoStatus(config, batch.tx_signature, fetchImpl);
        if (status === "confirmed") {
          await db
            .updateTable("tournament_provenance_batches")
            .set({ confirmed_at: now })
            .where("id", "=", batch.id)
            .execute();
          report.confirmed.push(hour);
          continue;
        }
        if (status === null && now.getTime() - batch.posted_at.getTime() < REPOST_AFTER_MS) {
          report.waiting.push(hour);
          continue;
        }
      }
      const signature = await postMemo(config, batch.memo, fetchImpl);
      await db
        .updateTable("tournament_provenance_batches")
        .set({ tx_signature: signature, posted_at: now })
        .where("id", "=", batch.id)
        .execute();
      report.posted.push(hour);
    } catch (error) {
      report.errors.push({
        hourStart: hour,
        message: error instanceof Error ? error.message : "posting failed",
      });
    }
  }
  return report;
}

export interface ProvenanceProof {
  readonly event: {
    readonly id: string;
    readonly questionId: string;
    readonly questionSlug: string;
    readonly questionTitle: string;
    readonly userId: string;
    readonly forecaster: PublicIdentity | null;
    readonly submittedAt: string;
    /** The binary forecast's P(YES); null otherwise. */
    readonly p: number | null;
    /** The forward forecast's level, in the question's unit; null otherwise. */
    readonly value: number | null;
    /** A legacy (pre-013) event's bucket vector, from the archive; null otherwise. */
    readonly archivedProbs: number[] | null;
    /**
     * The payload exactly as hashed (`forecastCanonical`): `0.4200000000,0.5800000000`
     * for a binary, `fwd:412.0000000000` for a forward, the vector for a legacy event.
     */
    readonly payloadCanonical: string;
    readonly eventHash: string;
  };
  /** True when the stored event hash recomputes from the fields above. */
  readonly hashMatches: boolean;
  readonly batch: {
    readonly hourStart: string;
    readonly root: string;
    readonly leafCount: number;
    readonly leafIndex: number;
    readonly path: readonly string[];
    readonly memo: string;
    readonly txSignature: string | null;
    readonly postedAt: string | null;
    readonly confirmedAt: string | null;
    readonly explorerUrl: string | null;
  } | null;
  /** True when the path folds the event hash to the batch root. */
  readonly pathMatches: boolean | null;
}

export async function getProvenanceProof(
  db: Kysely<Database>,
  eventId: string,
  cluster: SolanaConfig["cluster"] = "mainnet-beta",
): Promise<ProvenanceProof> {
  const event = await db
    .selectFrom("tournament_forecast_events as events")
    .innerJoin("tournament_questions as questions", "questions.id", "events.question_id")
    .leftJoin("tournament_archived_forecast_vectors as archived", "archived.event_id", "events.id")
    .select([
      "events.id",
      "events.user_id",
      "events.question_id",
      "events.submitted_at",
      "events.p",
      "events.value",
      "events.event_hash",
      "archived.probs as archived_probs",
      "questions.slug",
      "questions.title",
      "questions.status",
    ])
    .where("events.id", "=", eventId)
    .executeTakeFirst();
  if (event === undefined || event.status === "draft") {
    throw new ServiceError("FORECAST_NOT_FOUND", "No forecast has that id.");
  }
  const forecast = {
    ...toForecastPoint(event),
    archivedProbs: event.archived_probs === null ? null : toNumbers(event.archived_probs),
  };
  const leaf = await db
    .selectFrom("tournament_provenance_leaves as leaves")
    .innerJoin("tournament_provenance_batches as batches", "batches.id", "leaves.batch_id")
    .selectAll("batches")
    .select(["leaves.leaf_index", "leaves.path"])
    .where("leaves.event_id", "=", eventId)
    .executeTakeFirst();
  const identity = (await identitiesFor(db, [event.user_id])).get(event.user_id);

  return {
    event: {
      id: event.id,
      questionId: event.question_id,
      questionSlug: event.slug,
      questionTitle: event.title,
      userId: event.user_id,
      forecaster: identity ?? null,
      submittedAt: event.submitted_at.toISOString(),
      ...forecast,
      payloadCanonical: forecastCanonical(forecast),
      eventHash: event.event_hash,
    },
    hashMatches:
      forecastEventHash(event.question_id, event.user_id, event.submitted_at, forecast) ===
      event.event_hash,
    batch:
      leaf === undefined
        ? null
        : {
            hourStart: leaf.hour_start.toISOString(),
            root: leaf.root,
            leafCount: leaf.leaf_count,
            leafIndex: leaf.leaf_index,
            path: leaf.path,
            memo: leaf.memo,
            txSignature: leaf.tx_signature,
            postedAt: leaf.posted_at?.toISOString() ?? null,
            confirmedAt: leaf.confirmed_at?.toISOString() ?? null,
            explorerUrl:
              leaf.tx_signature === null ? null : explorerUrl(leaf.tx_signature, cluster),
          },
    pathMatches:
      leaf === undefined ? null : merkleRootFromPath(event.event_hash, leaf.path) === leaf.root,
  };
}

export interface ProvenanceRun {
  readonly created: CreatedBatch[];
  /** Null when no provenance wallet is configured: roots are committed but not posted. */
  readonly posting: PostingReport | null;
}

/** The hourly job: commit completed hours, then move every unconfirmed batch along. */
export async function runProvenance(
  db: Kysely<Database>,
  config: SolanaConfig | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ProvenanceRun> {
  const created = await batchCompletedHours(db);
  const posting = config === null ? null : await postPendingBatches(db, config, fetchImpl);
  return { created, posting };
}
