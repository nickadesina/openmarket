export const EPS = 1e-9;
export const MIN_QUANTITY = 0.000001;
/** Ceilings that keep trade inputs inside the engine's finite arithmetic. */
export const MAX_QUANTITY = 1_000_000_000;
export const MAX_TRADE_SPEND_CENTS = 100_000_000_000;

export type ContractSide = "yes" | "no";
export type TradeAction = "buy" | "sell";

export interface OrderedMark {
  readonly marketSequence: number;
  readonly timestamp: Date;
  readonly value: number;
}

export interface DecomposedPosition {
  readonly side: ContractSide;
  readonly strikeIndex: number;
  readonly quantity: number;
}
