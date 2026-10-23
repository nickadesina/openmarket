"use client";

import { Fragment, useState } from "react";
import {
  formatPrice,
  formatProbability,
  formatSigma,
  formatValuation,
} from "../../lib/client/format.js";
import type { ImpliedDistribution } from "../market-workspace/types.js";
import styles from "./strike-ladder.module.css";

interface StrikeLadderProps {
  readonly distribution: ImpliedDistribution;
}

type Strike = ImpliedDistribution["strikes"][number];

// Outside this band a strike is all but settled on one side; the board folds
// those into OVER / UNDER aggregate rows the way a Japanese 板 caps its tails.
const CONTESTED_MIN = 0.05;
const CONTESTED_MAX = 0.95;

/**
 * The read-only ladder (README D11): P(next print > strike) at every grid
 * strike, from the API's implied distribution around the forward mid. Nothing
 * here trades; the forward and the binary trade in the ticket.
 */
export function StrikeLadder({ distribution }: StrikeLadderProps) {
  const [showOver, setShowOver] = useState(false);
  const [showUnder, setShowUnder] = useState(false);

  // Highest strike first, like a price board: the book reads downward from
  // the improbable top to the near-certain bottom.
  const descending = [...distribution.strikes].reverse();
  const isContested = (strike: Strike) =>
    strike.probabilityAbove >= CONTESTED_MIN && strike.probabilityAbove <= CONTESTED_MAX;
  const firstContested = descending.findIndex(isContested);
  const lastContested = descending.length - 1 - [...descending].reverse().findIndex(isContested);
  const hasContested = firstContested !== -1;
  const overTail = hasContested ? descending.slice(0, firstContested) : [];
  const underTail = hasContested ? descending.slice(lastContested + 1) : [];
  const body = hasContested ? descending.slice(firstContested, lastContested + 1) : descending;
  const visible = [...(showOver ? overTail : []), ...body, ...(showUnder ? underTail : [])];

  // The bar behind each strike is the mass of the bucket just below it.
  const massBelow = (strike: Strike) => distribution.pmf[strike.strikeIndex] ?? 0;
  const maxMass = Math.max(...distribution.pmf, 0.0001);

  // The forward mid sits between two strikes; a 現在値 row marks that gap.
  const mid = distribution.centerUsd;
  const midAfter = visible.find((strike, position) => {
    const next = visible[position + 1];
    return (
      Number(strike.strikeValueUsd) > mid &&
      (next === undefined || Number(next.strikeValueUsd) <= mid)
    );
  });
  const midAboveAll = visible.length > 0 && Number(visible[0]!.strikeValueUsd) <= mid;

  const midRow = (
    <tr className={styles.currentRow} key="current">
      <td colSpan={2}>
        <span className={styles.currentLabel}>Forward mid</span>
        <strong className={styles.currentValue}>{formatPrice(mid)}</strong>
      </td>
    </tr>
  );

  const tailRow = (
    tail: readonly Strike[],
    kind: "over" | "under",
    expanded: boolean,
    toggle: () => void,
  ) => {
    if (tail.length === 0) return null;
    const edge = kind === "over" ? tail[tail.length - 1]! : tail[0]!;
    const count = `${tail.length} ${tail.length === 1 ? "strike" : "strikes"}`;
    const summary =
      kind === "over"
        ? `${count} from ${formatValuation(edge.strikeValueUsd)} up · above ≤ ${formatProbability(edge.probabilityAbove)}`
        : `${count} from ${formatValuation(edge.strikeValueUsd)} down · above ≥ ${formatProbability(edge.probabilityAbove)}`;
    return (
      <button type="button" className={styles.tailRow} aria-expanded={expanded} onClick={toggle}>
        <span className={styles.tailKind}>{kind === "over" ? "Over" : "Under"}</span>
        <span className={styles.tailSummary}>{summary}</span>
        <span className={styles.tailAction}>{expanded ? "Fold" : "Unfold"}</span>
      </button>
    );
  };

  return (
    <section className={styles.section} aria-labelledby="ladder-title">
      <header className={styles.header}>
        <div>
          <h2 id="ladder-title" className={styles.tab}>
            Implied ladder
          </h2>
          <p>
            The chance the next print lands above each strike, from a lognormal at the forward mid
            with the tier&apos;s prior width (σ {formatSigma(distribution.sigma)}). Read-only: the
            shaded bar is the probability mass just below each strike, and tails carry a{" "}
            {formatProbability(distribution.floor)} floor per bucket.
          </p>
        </div>
        <span className={styles.headerAside}>Not traded</span>
      </header>

      {tailRow(overTail, "over", showOver, () => setShowOver((value) => !value))}

      <div className={styles.tableScroller}>
        <table className={styles.table}>
          <thead className={styles.head}>
            <tr>
              <th scope="col" className={styles.strikeHead}>
                Valuation above
              </th>
              <th scope="col" className={styles.yesHead}>
                Implied probability
              </th>
            </tr>
          </thead>
          <tbody>
            {midAboveAll ? midRow : null}
            {visible.map((strike) => {
              const depth = Math.round((massBelow(strike) / maxMass) * 100);
              return (
                <Fragment key={strike.strikeIndex}>
                  <tr>
                    <th scope="row" className={styles.strikeCell}>
                      <span
                        className={styles.depth}
                        style={{ width: `${depth}%` }}
                        aria-hidden="true"
                      />
                      <span className={styles.strikeValue}>
                        {formatValuation(strike.strikeValueUsd)}
                      </span>
                    </th>
                    <td className={styles.probabilityCell}>
                      {formatProbability(strike.probabilityAbove)}
                    </td>
                  </tr>
                  {strike === midAfter ? midRow : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {tailRow(underTail, "under", showUnder, () => setShowUnder((value) => !value))}
    </section>
  );
}
