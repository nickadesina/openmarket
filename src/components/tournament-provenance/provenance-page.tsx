"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiRequest } from "../../lib/client/api.js";
import { formatTournamentDateTime } from "../../lib/client/format.js";
import { verifyProofInBrowser } from "../../lib/client/provenance.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { ProvenanceProof } from "../../lib/services/tournament/provenance.js";
import { ForecasterName } from "../tournament-forecaster-name/forecaster-name.js";
import styles from "./provenance-page.module.css";

function Check({ ok }: { readonly ok: boolean | null | undefined }) {
  if (ok === undefined) return <span className={styles.pending}>Checking…</span>;
  if (ok === null) return <span className={styles.pending}>Not batched yet</span>;
  return ok ? (
    <span className={styles.match}>Matches</span>
  ) : (
    <span className={styles.mismatch}>Does not match</span>
  );
}

function chainStatus(batch: NonNullable<ProvenanceProof["batch"]>): string {
  if (batch.confirmedAt !== null) return `Confirmed ${formatTournamentDateTime(batch.confirmedAt)}`;
  if (batch.postedAt !== null)
    return `Posted ${formatTournamentDateTime(batch.postedAt)}, awaiting confirmation`;
  return "Committed; not posted to Solana yet";
}

export function ProvenancePage({
  eventId,
  initialProof,
}: {
  readonly eventId: string;
  readonly initialProof: ProvenanceProof | null;
}) {
  const proofQuery = useQuery({
    queryKey: queryKeys.tournamentProvenance(eventId),
    queryFn: () => apiRequest<ProvenanceProof>(`/api/t/provenance/${eventId}`),
    ...(initialProof === null ? {} : { initialData: initialProof }),
  });
  const proof = proofQuery.data;
  const browserCheck = useQuery({
    queryKey: [...queryKeys.tournamentProvenance(eventId), "browser", proof?.batch?.root ?? null],
    queryFn: () => verifyProofInBrowser(proof!),
    enabled: proof !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (proofQuery.isPending) {
    return <div className={styles.skeleton} role="status" aria-label="Loading proof" />;
  }
  if (proofQuery.isError || proof === undefined) {
    return (
      <div className={styles.statePanel} role="alert">
        <strong>No forecast has this id.</strong>
        <p>Proof links come from a question's latest forecasts.</p>
      </div>
    );
  }

  const { event, batch } = proof;
  const verification = browserCheck.data;
  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <h1>Timestamp proof</h1>
        <p>
          {event.forecaster === null ? (
            "A forecast"
          ) : (
            <>
              <ForecasterName identity={event.forecaster} />
              's forecast
            </>
          )}{" "}
          on <Link href={`/t/q/${event.questionSlug}`}>{event.questionTitle}</Link>, submitted{" "}
          {formatTournamentDateTime(event.submittedAt)}.
        </p>
      </header>

      <section className={styles.module} aria-labelledby="proof-chain">
        <h2 className={styles.tab} id="proof-chain">
          Chain of hashes
        </h2>
        <dl className={styles.spec}>
          <div>
            <dt>Event hash</dt>
            <dd className={styles.hash}>{event.eventHash}</dd>
          </div>
          <div>
            <dt>Recomputed here</dt>
            <dd>
              <Check ok={verification?.hashMatches} />
            </dd>
          </div>
          {batch === null ? (
            <div>
              <dt>Batch</dt>
              <dd>
                Each completed hour is committed a few minutes after it ends and posted to Solana by
                the hourly job.
              </dd>
            </div>
          ) : (
            <>
              <div>
                <dt>Hourly batch</dt>
                <dd>
                  {formatTournamentDateTime(batch.hourStart)} · leaf {batch.leafIndex + 1} of{" "}
                  {batch.leafCount}
                </dd>
              </div>
              <div>
                <dt>Merkle root</dt>
                <dd className={styles.hash}>{batch.root}</dd>
              </div>
              <div>
                <dt>Root from path, here</dt>
                <dd>
                  <Check ok={verification?.rootMatches} />
                </dd>
              </div>
              <div>
                <dt>Solana memo</dt>
                <dd>
                  {batch.explorerUrl === null ? (
                    chainStatus(batch)
                  ) : (
                    <>
                      <a href={batch.explorerUrl} target="_blank" rel="noopener noreferrer">
                        View transaction
                      </a>{" "}
                      · {chainStatus(batch)}
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Memo text</dt>
                <dd className={styles.hash}>{batch.memo}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {batch === null || batch.path.length === 0 ? null : (
        <section className={styles.module} aria-labelledby="proof-path">
          <h2 className={styles.tab} id="proof-path">
            Merkle path
          </h2>
          <ol className={styles.path}>
            {batch.path.map((step) => (
              <li key={step}>
                <span className={styles.side}>{step.startsWith("L") ? "Left" : "Right"}</span>
                <span className={styles.hash}>{step.slice(2)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className={styles.module} aria-labelledby="proof-recipe">
        <h2 className={styles.tab} id="proof-recipe">
          Check it yourself
        </h2>
        <div className={styles.recipe}>
          <p>
            event_hash = sha256 of the UTF-8 concatenation question_id ‖ user_id ‖ submitted_at ‖
            probs. The four inputs, one per line here, are joined with no separators:
          </p>
          <pre className={styles.code}>
            {`${event.questionId}\n${event.userId}\n${event.submittedAt}\n${event.probsCanonical}`}
          </pre>
          <p>
            leaf = sha256(0x00 ‖ event_hash). For each path step, node = sha256(0x01 ‖ left ‖
            right), with the step's hash on the side it names. The result is the batch root, which
            the memo above carries on Solana with its hour and leaf count.
          </p>
        </div>
      </section>
    </article>
  );
}
