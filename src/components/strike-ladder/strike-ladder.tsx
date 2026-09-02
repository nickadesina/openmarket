"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { formatMetricPrice, formatProbability, formatValuation } from "../../lib/client/format.js";
import type { MarketDetail, TradeSelection } from "../market-workspace/types.js";
import styles from "./strike-ladder.module.css";

interface StrikeLadderProps {
  readonly market: MarketDetail;
  readonly selection: TradeSelection | null;
  readonly onSelect: (selection: TradeSelection) => void;
}

type Contract = MarketDetail["contracts"][number];

// Outside this band a strike is near-certain on one side; the board folds
// those into OVER / UNDER aggregate rows the way a Japanese 板 caps its tails.
const CONTESTED_MIN = 0.015;
const CONTESTED_MAX = 0.985;

function strikeValue(contract: Contract): number {
  return contract.strikeValueUsd === null ? Number.NaN : Number(contract.strikeValueUsd);
}

export function StrikeLadder({ market, selection, onSelect }: StrikeLadderProps) {
  const isBinary = market.metric.kind === "yes_probability";
  const [showOver, setShowOver] = useState(false);
  const [showUnder, setShowUnder] = useState(false);
  const scrollerNode = useRef<HTMLDivElement>(null);
  const currentRowNode = useRef<HTMLTableRowElement>(null);

  // Highest strike first, like a price board: the book reads downward from
  // the improbable top to the near-certain bottom.
  const ascending = market.contracts;
  const descending = [...ascending].reverse();
  const selectedIndex = selection?.strikeIndex;
  const isContested = (contract: Contract) =>
    contract.strikeIndex === selectedIndex ||
    (contract.yesProbability >= CONTESTED_MIN && contract.yesProbability <= CONTESTED_MAX);
  const firstContested = descending.findIndex(isContested);
  const lastContested = descending.length - 1 - [...descending].reverse().findIndex(isContested);
  const hasContested = firstContested !== -1;
  const overTail = hasContested && !isBinary ? descending.slice(0, firstContested) : [];
  const underTail = hasContested && !isBinary ? descending.slice(lastContested + 1) : [];
  const body =
    hasContested && !isBinary ? descending.slice(firstContested, lastContested + 1) : descending;
  const visible = [...(showOver ? overTail : []), ...body, ...(showUnder ? underTail : [])];

  // Probability mass that lands in the bucket just below each strike: the
  // depth column of this book. Derived from adjacent YES probabilities.
  const yesByIndex = new Map(
    ascending.map((contract) => [contract.strikeIndex, contract.yesProbability]),
  );
  const massBelow = (contract: Contract): number => {
    const position = ascending.findIndex((item) => item.strikeIndex === contract.strikeIndex);
    const lower = ascending[position - 1];
    const lowerYes = lower === undefined ? 1 : (yesByIndex.get(lower.strikeIndex) ?? 1);
    return Math.max(0, lowerYes - contract.yesProbability);
  };
  const maxMass = Math.max(...ascending.map(massBelow), 0.0001);

  // The implied valuation sits between two strikes; the book marks that gap
  // with a 現在値 row so the eye finds the market's own estimate immediately.
  const current = market.metric.current;
  const currentAfter = isBinary
    ? undefined
    : visible.find((contract, position) => {
        const next = visible[position + 1];
        return (
          strikeValue(contract) > current && (next === undefined || strikeValue(next) <= current)
        );
      });
  const currentAboveAll = !isBinary && visible.length > 0 && strikeValue(visible[0]!) <= current;

  const marketId = market.marketId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the money once per market, not on every poll.
  useEffect(() => {
    const scroller = scrollerNode.current;
    const row = currentRowNode.current;
    if (scroller === null || row === null || scroller.scrollHeight <= scroller.clientHeight) return;
    scroller.scrollTop = Math.max(
      0,
      row.offsetTop - scroller.clientHeight / 2 + row.offsetHeight / 2,
    );
  }, [marketId]);

  const currentRow = (
    <tr className={styles.currentRow} ref={currentRowNode} key="current">
      <td colSpan={3}>
        <span className={styles.currentLabel}>{market.metric.label}</span>
        <strong className={styles.currentValue}>
          {formatMetricPrice(current, market.metric.kind)}
        </strong>
      </td>
    </tr>
  );

  const tailRow = (
    tail: readonly Contract[],
    kind: "over" | "under",
    expanded: boolean,
    toggle: () => void,
  ) => {
    if (tail.length === 0) return null;
    const edge = kind === "over" ? tail[tail.length - 1]! : tail[0]!;
    const summary =
      kind === "over"
        ? `${tail.length} ${tail.length === 1 ? "strike" : "strikes"} from ${formatValuation(edge.strikeValueUsd ?? "0")} up · YES ≤ ${formatProbability(edge.yesProbability)}`
        : `${tail.length} ${tail.length === 1 ? "strike" : "strikes"} from ${formatValuation(edge.strikeValueUsd ?? "0")} down · YES ≥ ${formatProbability(edge.yesProbability)}`;
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
            {isBinary ? "Outcome contract" : "Probability ladder"}
          </h2>
          <p>
            {isBinary
              ? "Select YES or NO to prepare a quote."
              : "Each row is a strike. Pick a side to load it into the order form; the shaded bar is the probability mass landing just below that strike."}
          </p>
        </div>
        <span className={styles.headerAside}>
          {market.status === "open" ? "Click a price to trade" : "Trading closed"}
        </span>
      </header>

      {tailRow(overTail, "over", showOver, () => setShowOver((value) => !value))}

      <div className={styles.tableScroller} ref={scrollerNode}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.noHead}>
                NO probability
              </th>
              <th scope="col" className={styles.strikeHead}>
                {isBinary ? "Contract" : "Valuation above"}
              </th>
              <th scope="col" className={styles.yesHead}>
                YES probability
              </th>
            </tr>
          </thead>
          <tbody>
            {currentAboveAll ? currentRow : null}
            {visible.map((contract) => {
              const yesSelected =
                selection?.strikeIndex === contract.strikeIndex && selection.side === "yes";
              const noSelected =
                selection?.strikeIndex === contract.strikeIndex && selection.side === "no";
              const strike =
                contract.strikeValueUsd === null
                  ? "Outcome"
                  : formatValuation(contract.strikeValueUsd);
              const depth = isBinary ? 0 : Math.round((massBelow(contract) / maxMass) * 100);
              return (
                <Fragment key={contract.strikeIndex}>
                  <tr className={yesSelected || noSelected ? styles.selectedRow : undefined}>
                    <td className={styles.noCell}>
                      <button
                        type="button"
                        className={styles.noPrice}
                        aria-pressed={noSelected}
                        disabled={market.status === "settled"}
                        onClick={() => onSelect({ strikeIndex: contract.strikeIndex, side: "no" })}
                      >
                        <strong>{formatProbability(contract.noProbability)}</strong>
                        <span>NO</span>
                      </button>
                    </td>
                    <th scope="row" className={styles.strikeCell}>
                      <span
                        className={styles.depth}
                        style={{ width: `${depth}%` }}
                        aria-hidden="true"
                      />
                      <span className={styles.strikeValue}>{strike}</span>
                    </th>
                    <td className={styles.yesCell}>
                      <button
                        type="button"
                        className={styles.yesPrice}
                        aria-pressed={yesSelected}
                        disabled={market.status === "settled"}
                        onClick={() => onSelect({ strikeIndex: contract.strikeIndex, side: "yes" })}
                      >
                        <span>YES</span>
                        <strong>{formatProbability(contract.yesProbability)}</strong>
                      </button>
                    </td>
                  </tr>
                  {contract === currentAfter ? currentRow : null}
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
