import type { ForwardExecutionResult } from "../../lib/services/dealer/execute-forward-trade.js";
import type {
  BinaryInstrumentQuote,
  ForwardInstrumentQuote,
} from "../../lib/services/dealer/get-instrument-quote.js";
import type { ExecutionResult } from "../../lib/services/execute-trade.js";
import type { ActivityItem, ActivityPage } from "../../lib/services/get-activity.js";
import type {
  ImpliedDistribution,
  ListingDetail,
  ListingView,
} from "../../lib/services/get-market.js";
import type { MarkHistory, MarkRange } from "../../lib/services/get-marks.js";
import type { QuoteResult } from "../../lib/services/quote.js";

export type {
  ActivityItem,
  ActivityPage,
  BinaryInstrumentQuote,
  ExecutionResult,
  ForwardExecutionResult,
  ForwardInstrumentQuote,
  ImpliedDistribution,
  ListingDetail,
  ListingView,
  MarkHistory,
  MarkRange,
  QuoteResult,
};

export type TradeAction = "buy" | "sell";
export type BuyInputMode = "spend" | "quantity";

/** The contract the ticket works: a side of the forward or of the binary. */
export type TradeSelection =
  | { readonly contract: "forward"; readonly side: "long" | "short" }
  | { readonly contract: "binary"; readonly side: "yes" | "no" };
