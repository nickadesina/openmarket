export const EPS = 1e-9;
/** Float noise tolerance around a whole cent during collateral and settlement. */
export const CENT_TOLERANCE = 1e-6;
export const SQRT_TWO = Math.sqrt(2);
export const MIN_QUANTITY = 0.000001;
/** Ceilings that keep trade inputs inside the engine's finite arithmetic. */
export const MAX_QUANTITY = 1_000_000_000;
export const MAX_TRADE_SPEND_CENTS = 100_000_000_000;

export type ContractSide = "yes" | "no";
export type TradeAction = "buy" | "sell";
