export const EPS = 1e-9;
export const MIN_QUANTITY = 0.000001;

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
