"use client";

import styles from "./strike-ladder.module.css";
import { formatProbability, formatValuation, type MarketDetail, type TradeSelection } from "../market-workspace/types.js";

interface StrikeLadderProps {
  readonly market: MarketDetail;
  readonly selection: TradeSelection | null;
  readonly onSelect: (selection: TradeSelection) => void;
}

export function StrikeLadder({ market, selection, onSelect }: StrikeLadderProps) {
  const isBinary = market.metric.kind === "yes_probability";

  return (
    <section className={styles.section} aria-labelledby="ladder-title">
      <header className={styles.header}>
        <div>
          <h2 id="ladder-title">{isBinary ? "Outcome contract" : "Probability ladder"}</h2>
          <p>{isBinary ? "Select YES or NO to prepare a quote." : "YES probability declines as the valuation strike increases."}</p>
        </div>
        {market.status === "open" ? <span>Select a price</span> : <span>Trading closed</span>}
      </header>
      <div className={styles.tableScroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{isBinary ? "Contract" : "Valuation above"}</th>
              <th scope="col">YES probability</th>
              <th scope="col">NO probability</th>
            </tr>
          </thead>
          <tbody>
            {market.contracts.map((contract) => {
              const yesSelected = selection?.strikeIndex === contract.strikeIndex && selection.side === "yes";
              const noSelected = selection?.strikeIndex === contract.strikeIndex && selection.side === "no";
              const strike = contract.strikeValueUsd === null ? "Outcome" : formatValuation(contract.strikeValueUsd);
              return (
                <tr key={contract.strikeIndex} className={yesSelected || noSelected ? styles.selectedRow : undefined}>
                  <th scope="row">{strike}</th>
                  <td>
                    <button
                      type="button"
                      className={styles.probability}
                      aria-pressed={yesSelected}
                      disabled={market.status === "settled"}
                      onClick={() => onSelect({ strikeIndex: contract.strikeIndex, side: "yes" })}
                    >
                      <strong>{formatProbability(contract.yesProbability)}</strong>
                      <span>YES</span>
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.probability}
                      aria-pressed={noSelected}
                      disabled={market.status === "settled"}
                      onClick={() => onSelect({ strikeIndex: contract.strikeIndex, side: "no" })}
                    >
                      <strong>{formatProbability(contract.noProbability)}</strong>
                      <span>NO</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
