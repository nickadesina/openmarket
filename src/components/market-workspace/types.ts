import type { ExecutionResult } from "../../lib/services/execute-trade.js";
import type { ActivityPage } from "../../lib/services/get-activity.js";
import type { MarketDetail } from "../../lib/services/get-market.js";
import type { MarkHistory, MarkRange } from "../../lib/services/get-marks.js";
import type { QuoteResult } from "../../lib/services/quote.js";

export type { ActivityPage, ExecutionResult, MarketDetail, MarkHistory, MarkRange, QuoteResult };

export type TradeAction = "buy" | "sell";
export type ContractSide = "yes" | "no";
export type BuyInputMode = "spend" | "quantity";

export interface TradeSelection {
  readonly strikeIndex: number;
  readonly side: ContractSide;
}
