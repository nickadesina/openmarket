import styles from "./trade-ticket.module.css";

/**
 * 稟議 strip: each box seals when the order has provably cleared that stage.
 * Sent stays sealed while the outcome is unknown; Filled only on a server 200,
 * with a muted "?" while the outcome is unknown. It reads after the action
 * that drives it.
 */
export function ApprovalStrip({
  quoted,
  sent,
  filled,
  unknown,
}: {
  readonly quoted: boolean;
  readonly sent: boolean;
  readonly filled: boolean;
  readonly unknown: boolean;
}) {
  const stages = [
    ["Quoted", quoted],
    ["Sent", sent],
    ["Filled", filled],
  ] as const;
  return (
    <ol className={styles.approvals} aria-label="Order progress">
      {stages.map(([stage, done]) => (
        <li key={stage} className={styles.approval} aria-current={done ? "step" : undefined}>
          <span className={styles.approvalBox}>
            {done ? (
              <span className={styles.approvalSeal}>{stage === "Filled" ? "Filled" : "OK"}</span>
            ) : stage === "Filled" && unknown ? (
              <span className={styles.approvalUnknown} role="img" aria-label="Unknown">
                ?
              </span>
            ) : null}
          </span>
          <span className={styles.approvalLabel}>{stage}</span>
        </li>
      ))}
    </ol>
  );
}

/** The unknown-outcome controls both tickets share: one retry with the same key, one abandon. */
export function PendingOrderActions({
  executing,
  onRetry,
  onAbandon,
}: {
  readonly executing: boolean;
  readonly onRetry: () => void;
  readonly onAbandon: () => void;
}) {
  return (
    <div className={styles.orderActions}>
      <button type="button" className={styles.primary} onClick={onRetry} disabled={executing}>
        {executing ? "Retrying…" : "Retry same trade"}
      </button>
      <button type="button" className={styles.secondary} onClick={onAbandon} disabled={executing}>
        Abandon order
      </button>
      <small>
        Retrying resends the identical request; the server replays the fill if it already
        happened. Abandoning does not cancel a fill: check the portfolio.
      </small>
    </div>
  );
}

export const RETRYABLE_ERROR = {
  code: "RETRYABLE",
  message:
    "Execution status is unknown. Retry with the same request key to avoid a duplicate trade.",
} as const;

export type TicketError = { readonly code: string; readonly message: string };
