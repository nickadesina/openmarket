import type { Kysely, Transaction } from "kysely";

import type { Database, ForwardSide, MetricKind, TradeAction } from "../db/schema.js";
import {
  collateralCents,
  settlementCreditCents,
  voidCreditCents,
} from "../engine/dealer/forward.js";
import {
  probabilities,
  quantizeBuyCostCents,
  quantizeEntitlementCents,
  quantizeSellProceedsCents,
  tradeCost,
} from "../engine/lmsr.js";
import { EPS } from "../engine/types.js";
import { INITIAL_USER_BALANCE_CENTS } from "./user.js";

export interface ReplayMarketInput {
  readonly id: string;
  readonly companySlug: string;
  /** A `forward_ln` book replays by forward rules; anything else by the LMSR. Default LMSR. */
  readonly metricKind?: MetricKind;
  readonly nBuckets: number;
  readonly b: number;
  readonly initialQ: readonly number[];
  readonly q: readonly number[];
  readonly lastMarketSequence: string;
  readonly mmCashFlowCents: string;
  readonly roundingReserveCents: string;
}

export interface ReplayTradeInput {
  readonly id: string;
  readonly marketId: string;
  readonly marketSequence: string;
  readonly action: TradeAction;
  /** yes/no on an LMSR book, long/short on a forward. Absent in pre-dealer snapshots. */
  readonly contractSide?: string;
  readonly delta: readonly number[];
  readonly cashAmountCents: string;
  readonly redemptionQuantity: number;
  readonly redemptionCents: string;
  readonly metricAfter: number;
  readonly createdAt: Date;
}

export interface ReplayMarkInput {
  readonly marketId: string;
  readonly marketSequence: string;
  readonly tradeId: string | null;
  readonly timestamp: Date;
  readonly value: number;
}

export interface ReplayHoldingInput {
  readonly userId: string;
  readonly marketId: string;
  readonly h: readonly number[];
}

export interface ReplayUserInput {
  readonly id: string;
  readonly cashBalanceCents: string;
}

/** A `forward_positions` row: one per forward trade. */
export interface ReplayForwardPositionInput {
  readonly id: string;
  readonly marketId: string;
  readonly tradeId: string;
  readonly side: ForwardSide;
  readonly notionalCents: string;
  readonly entryLn: number;
  readonly collateralCents: string;
  readonly settled: boolean;
  readonly settleLn: number | null;
  /** Credit − collateral, as the settle job stored it. */
  readonly payoutCents: string | null;
  readonly voided: boolean;
}

export interface ReplaySnapshot {
  readonly markets: readonly ReplayMarketInput[];
  readonly trades: readonly ReplayTradeInput[];
  readonly marks: readonly ReplayMarkInput[];
  readonly holdings: readonly ReplayHoldingInput[];
  readonly users: readonly ReplayUserInput[];
  readonly forwardPositions?: readonly ReplayForwardPositionInput[];
}

/** A forward book whose trades, positions or cash disagree with forward.ts's rules. */
export interface ForwardFinding {
  readonly code:
    | "TRADE_WITHOUT_POSITION"
    | "POSITION_WITHOUT_TRADE"
    | "POSITION_MISMATCH"
    | "COLLATERAL"
    | "DELTA"
    | "CREDIT"
    | "MM_CASH_FLOW";
  readonly detail: string;
}

export interface SequenceRange {
  readonly from: string;
  readonly to: string;
}

export interface DuplicateSequence {
  readonly sequence: string;
  readonly count: number;
}

export interface SequenceDiagnostics {
  readonly expectedStart: string;
  readonly expectedEnd: string;
  readonly observed: readonly string[];
  readonly missingRanges: readonly SequenceRange[];
  readonly duplicates: readonly DuplicateSequence[];
  readonly unexpected: readonly string[];
  readonly invalid: readonly string[];
  readonly contiguous: boolean;
  readonly passed: boolean;
}

export interface StateFinding {
  readonly code:
    | "INVALID_MARKET_SEQUENCE"
    | "INVALID_VECTOR_LENGTH"
    | "NONFINITE_VECTOR_VALUE"
    | "INVALID_LIQUIDITY"
    | "INVALID_PMF"
    | "INVALID_TRADE";
  readonly detail: string;
}

export interface BucketDriftDiagnostic {
  readonly absolute: number | null;
  readonly bucketIndex: number | null;
  readonly replayed: number | null;
  readonly persisted: number | null;
  readonly tolerance: number | null;
  readonly exceedsTolerance: boolean;
}

export interface NegativeHoldingFinding {
  readonly userId: string;
  readonly bucketIndex: number;
  readonly value: number;
}

/** A trade whose stored cents disagree with the engine re-run on the replayed state. */
export interface TradeEconomicsFinding {
  readonly tradeId: string;
  readonly marketSequence: string;
  readonly field: "cash_amount_cents" | "redemption_cents";
  readonly expected: string;
  readonly persisted: string;
}

export interface TradeMarkCardinalityFinding {
  readonly tradeId: string;
  readonly marketSequence: string;
  readonly matchingMarkCount: number;
  readonly linkedMarkCount: number;
  readonly linkedMarkSequences: readonly string[];
}

export type TradeMarkDisagreementField =
  | "trade_id"
  | "market_sequence"
  | "timestamp"
  | "metric"
  | "trade_not_found";

export interface TradeMarkDisagreement {
  readonly markSequence: string;
  readonly markTradeId: string | null;
  readonly tradeSequence: string | null;
  readonly expectedTradeId: string | null;
  readonly fields: readonly TradeMarkDisagreementField[];
}

export interface TimestampInversionFinding {
  readonly earlierSequence: string;
  readonly earlierTimestamp: string;
  readonly laterSequence: string;
  readonly laterTimestamp: string;
}

export interface MarketReplayDiagnostics {
  readonly marketId: string;
  readonly companySlug: string;
  readonly stateFindings: readonly StateFinding[];
  readonly maxBucketDrift: BucketDriftDiagnostic;
  readonly pmfNormalizationError: number | null;
  readonly negativeHoldings: readonly NegativeHoldingFinding[];
  readonly tradeEconomics: readonly TradeEconomicsFinding[];
  readonly tradeSequences: SequenceDiagnostics;
  readonly markSequences: SequenceDiagnostics;
  readonly tradeMarkCardinality: readonly TradeMarkCardinalityFinding[];
  readonly tradeMarkDisagreements: readonly TradeMarkDisagreement[];
  readonly timestampInversions: readonly TimestampInversionFinding[];
  readonly forwardFindings: readonly ForwardFinding[];
  readonly mmCashFlowCents: string;
  readonly roundingReserveCents: string;
  readonly passed: boolean;
}

export interface CashReconciliationDiagnostics {
  readonly seedBalancePerUserCents: string;
  readonly userCount: number;
  readonly seededBalanceCents: string | null;
  readonly currentUserCashCents: string | null;
  readonly marketMakerCashFlowCents: string | null;
  readonly roundingReserveCents: string | null;
  readonly differenceCents: string | null;
  readonly formula: "current_user_cash_cents + market_maker_cash_flow_cents - seeded_balance_cents";
  readonly roundingReserveAccounting: "Rounding reserve is reported separately and excluded from the difference because user cash and MM flow both record the same quantized transfers.";
  readonly invalidValues: readonly string[];
  readonly passed: boolean;
}

export interface ReplaySummary {
  readonly marketCount: number;
  readonly failedMarketCount: number;
  readonly maxBucketDrift: number | null;
  readonly maxPmfNormalizationError: number | null;
  readonly negativeHoldingCount: number;
  readonly tradeEconomicsFailureCount: number;
  readonly sequenceFailureCount: number;
  readonly tradeMarkCardinalityFailureCount: number;
  readonly tradeMarkDisagreementCount: number;
  readonly timestampInversionCount: number;
}

export interface ReplayDiagnostics {
  readonly tolerance: number;
  readonly markets: readonly MarketReplayDiagnostics[];
  readonly cashReconciliation: CashReconciliationDiagnostics;
  readonly summary: ReplaySummary;
  readonly passed: boolean;
}

interface ParsedSequence<T> {
  readonly row: T;
  readonly value: bigint;
  readonly inputIndex: number;
}

const INTEGER_PATTERN = /^-?(?:0|[1-9][0-9]*)$/;

function parseInteger(value: string): bigint | null {
  if (!INTEGER_PATTERN.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function finiteTimestamp(value: Date): number | null {
  const milliseconds = value.getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function isoTimestamp(value: Date): string {
  const milliseconds = finiteTimestamp(value);
  return milliseconds === null ? "Invalid Date" : new Date(milliseconds).toISOString();
}

function allowedError(left: number, right: number): number {
  return EPS * Math.max(1, Math.abs(left), Math.abs(right));
}

function numbersAgree(left: number, right: number): boolean {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= allowedError(left, right)
  );
}

function parseAndOrder<T>(
  rows: readonly T[],
  sequenceOf: (row: T) => string,
): { ordered: ParsedSequence<T>[]; invalid: string[] } {
  const ordered: ParsedSequence<T>[] = [];
  const invalid: string[] = [];

  rows.forEach((row, inputIndex) => {
    const raw = sequenceOf(row);
    const value = parseInteger(raw);
    if (value === null) {
      invalid.push(raw);
    } else {
      ordered.push({ row, value, inputIndex });
    }
  });

  ordered.sort((left, right) => {
    if (left.value < right.value) return -1;
    if (left.value > right.value) return 1;
    return left.inputIndex - right.inputIndex;
  });
  return { ordered, invalid };
}

function analyzeSequences(
  values: readonly string[],
  expectedStart: bigint,
  expectedEnd: bigint | null,
): SequenceDiagnostics {
  const parsed = parseAndOrder(values, (value) => value);
  const counts = new Map<string, number>();
  for (const item of parsed.ordered) {
    const sequence = item.value.toString();
    counts.set(sequence, (counts.get(sequence) ?? 0) + 1);
  }

  const observedValues = [...counts.keys()]
    .map((value) => BigInt(value))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const observed = observedValues.map(String);
  const duplicates = observedValues
    .map((sequence) => ({
      sequence: sequence.toString(),
      count: counts.get(sequence.toString()) ?? 0,
    }))
    .filter(({ count }) => count > 1);

  const unexpected =
    expectedEnd === null
      ? observed
      : observedValues.filter((value) => value < expectedStart || value > expectedEnd).map(String);

  const missingRanges: SequenceRange[] = [];
  if (expectedEnd !== null && expectedEnd >= expectedStart) {
    let nextExpected = expectedStart;
    for (const value of observedValues) {
      if (value < expectedStart || value > expectedEnd || value < nextExpected) continue;
      if (value > nextExpected) {
        missingRanges.push({ from: nextExpected.toString(), to: (value - 1n).toString() });
      }
      nextExpected = value + 1n;
    }
    if (nextExpected <= expectedEnd) {
      missingRanges.push({ from: nextExpected.toString(), to: expectedEnd.toString() });
    }
  }

  const invalid =
    expectedEnd === null ? ["invalid expected end", ...parsed.invalid] : parsed.invalid;
  const passed =
    invalid.length === 0 &&
    duplicates.length === 0 &&
    unexpected.length === 0 &&
    missingRanges.length === 0;

  return {
    expectedStart: expectedStart.toString(),
    expectedEnd: expectedEnd?.toString() ?? "invalid",
    observed,
    missingRanges,
    duplicates,
    unexpected,
    invalid,
    contiguous: passed,
    passed,
  };
}

/**
 * Replays a book's trades in sequence order from initial_q. An LMSR book's
 * cash is re-priced on the replayed state; a forward's is checked against its
 * position by analyzeForwardBook, since a fill moves no price.
 */
function replayTrades(
  market: ReplayMarketInput,
  trades: readonly ReplayTradeInput[],
  stateFindings: StateFinding[],
  isForward: boolean,
): { q: number[]; tradeEconomics: TradeEconomicsFinding[] } {
  const replayedQ = [...market.initialQ];
  const tradeEconomics: TradeEconomicsFinding[] = [];
  const orderedTrades = parseAndOrder(trades, (trade) => trade.marketSequence);
  for (const { row: trade } of orderedTrades.ordered) {
    if (trade.delta.length !== replayedQ.length) {
      stateFindings.push({
        code: "INVALID_VECTOR_LENGTH",
        detail: `trade ${trade.id} delta has ${trade.delta.length} buckets; expected ${replayedQ.length}`,
      });
      continue;
    }
    if (!replayedQ.every(Number.isFinite) || !trade.delta.every(Number.isFinite)) {
      stateFindings.push({
        code: "NONFINITE_VECTOR_VALUE",
        detail: `trade ${trade.id} cannot replay against a non-finite vector`,
      });
      continue;
    }

    // Re-price the trade on the replayed state: the ledger must have charged
    // exactly what the engine charges, not merely balanced its two legs.
    if (!isForward) repriceLmsrTrade(market, trade, replayedQ, tradeEconomics, stateFindings);

    for (let index = 0; index < replayedQ.length; index += 1) {
      replayedQ[index] = replayedQ[index]! + trade.delta[index]!;
    }
  }
  return { q: replayedQ, tradeEconomics };
}

function repriceLmsrTrade(
  market: ReplayMarketInput,
  trade: ReplayTradeInput,
  replayedQ: readonly number[],
  tradeEconomics: TradeEconomicsFinding[],
  stateFindings: StateFinding[],
): void {
  try {
    const costUsd = tradeCost(replayedQ, trade.delta, market.b);
    const expectedCash =
      trade.action === "buy" ? quantizeBuyCostCents(costUsd) : quantizeSellProceedsCents(costUsd);
    if (expectedCash.toString() !== trade.cashAmountCents) {
      tradeEconomics.push({
        tradeId: trade.id,
        marketSequence: trade.marketSequence,
        field: "cash_amount_cents",
        expected: expectedCash.toString(),
        persisted: trade.cashAmountCents,
      });
    }
    const expectedRedemption = quantizeEntitlementCents(trade.redemptionQuantity);
    if (expectedRedemption.toString() !== trade.redemptionCents) {
      tradeEconomics.push({
        tradeId: trade.id,
        marketSequence: trade.marketSequence,
        field: "redemption_cents",
        expected: expectedRedemption.toString(),
        persisted: trade.redemptionCents,
      });
    }
  } catch (error: unknown) {
    stateFindings.push({
      code: "INVALID_TRADE",
      detail: `trade ${trade.id}: ${error instanceof Error ? error.message : "cannot be re-priced"}`,
    });
  }
}

function pmfError(market: ReplayMarketInput, stateFindings: StateFinding[]): number | null {
  try {
    const pmf = probabilities(market.q, market.b);
    const sum = pmf.reduce((total, probability) => total + probability, 0);
    if (!Number.isFinite(sum)) throw new RangeError("non-finite PMF sum");
    return Math.abs(sum - 1);
  } catch (error: unknown) {
    stateFindings.push({
      code: "INVALID_PMF",
      detail: error instanceof Error ? error.message : "PMF calculation failed",
    });
    return null;
  }
}

function positionMismatch(
  trade: ReplayTradeInput,
  position: ReplayForwardPositionInput,
  kappa: number,
): ForwardFinding[] {
  const findings: ForwardFinding[] = [];
  const notional = Number(position.notionalCents);
  const usd = notional / 100;
  const expectedDelta = position.side === "long" ? [usd, 0] : [0, usd];
  if (trade.contractSide !== undefined && trade.contractSide !== position.side) {
    findings.push({
      code: "POSITION_MISMATCH",
      detail: `trade ${trade.id} is ${trade.contractSide}; its position is ${position.side}`,
    });
  }
  if (!trade.delta.every((value, index) => numbersAgree(value, expectedDelta[index]!))) {
    findings.push({
      code: "DELTA",
      detail: `trade ${trade.id} delta ${JSON.stringify(trade.delta)} is not ${position.side} ${usd}`,
    });
  }
  const collateral = String(collateralCents(notional, kappa));
  if (collateral !== position.collateralCents || collateral !== trade.cashAmountCents) {
    findings.push({
      code: "COLLATERAL",
      detail: `trade ${trade.id}: N·κ is ${collateral}; position ${position.collateralCents}, trade cash ${trade.cashAmountCents}`,
    });
  }
  return findings;
}

/** Cash a position has been credited back: its settlement credit, its void refund, or none. */
function creditOf(
  position: ReplayForwardPositionInput,
  kappa: number,
  findings: ForwardFinding[],
): bigint {
  const terms = {
    side: position.side,
    notionalCents: Number(position.notionalCents),
    entryLn: position.entryLn,
    kappa,
  };
  if (position.voided) return BigInt(voidCreditCents(terms));
  if (!position.settled) return 0n;
  if (position.settleLn === null || position.payoutCents === null) {
    findings.push({ code: "CREDIT", detail: `position ${position.id} settled without a payout` });
    return 0n;
  }
  const credit = settlementCreditCents(terms, position.settleLn);
  const payout = BigInt(credit) - BigInt(position.collateralCents);
  if (payout.toString() !== position.payoutCents) {
    findings.push({
      code: "CREDIT",
      detail: `position ${position.id}: payout ${position.payoutCents}, forward.ts ${payout}`,
    });
  }
  return BigInt(credit);
}

/**
 * A forward book (`forward_ln`, b = κ): trades and positions pair 1:1, each
 * trade's delta is its notional on its side, its cash is N·κ rounded up, and
 * the book's market-maker cash flow is Σ collateral − Σ credits recomputed
 * through forward.ts.
 */
function analyzeForwardBook(
  market: ReplayMarketInput,
  trades: readonly ReplayTradeInput[],
  positions: readonly ReplayForwardPositionInput[],
): ForwardFinding[] {
  const findings: ForwardFinding[] = [];
  const kappa = market.b;
  const byTrade = new Map(positions.map((position) => [position.tradeId, position]));
  const tradeIds = new Set(trades.map((trade) => trade.id));
  let collateral = 0n;
  for (const trade of trades) {
    const position = byTrade.get(trade.id);
    if (position === undefined) {
      findings.push({ code: "TRADE_WITHOUT_POSITION", detail: `trade ${trade.id}` });
      continue;
    }
    findings.push(...positionMismatch(trade, position, kappa));
    collateral += BigInt(trade.cashAmountCents);
  }
  let credits = 0n;
  for (const position of positions) {
    if (!tradeIds.has(position.tradeId)) {
      findings.push({ code: "POSITION_WITHOUT_TRADE", detail: `position ${position.id}` });
    }
    credits += creditOf(position, kappa, findings);
  }
  const expected = collateral - credits;
  if (parseInteger(market.mmCashFlowCents) !== expected) {
    findings.push({
      code: "MM_CASH_FLOW",
      detail: `mm_cash_flow_cents is ${market.mmCashFlowCents}; Σ collateral − Σ credits is ${expected}`,
    });
  }
  return findings;
}

function analyzeBucketDrift(
  market: ReplayMarketInput,
  replayedQ: readonly number[],
  stateFindings: StateFinding[],
) {
  let maximumDrift = -1;
  let driftBucket: number | null = null;
  let driftReplayed: number | null = null;
  let driftPersisted: number | null = null;
  let driftTolerance: number | null = null;
  const comparableLength = Math.min(replayedQ.length, market.q.length);
  for (let index = 0; index < comparableLength; index += 1) {
    const replayed = replayedQ[index];
    const persisted = market.q[index];
    if (
      replayed === undefined ||
      persisted === undefined ||
      !Number.isFinite(replayed) ||
      !Number.isFinite(persisted)
    ) {
      stateFindings.push({
        code: "NONFINITE_VECTOR_VALUE",
        detail: `market state contains a non-finite value at bucket ${index}`,
      });
      continue;
    }
    const drift = Math.abs(replayed - persisted);
    if (drift > maximumDrift) {
      maximumDrift = drift;
      driftBucket = index;
      driftReplayed = replayed;
      driftPersisted = persisted;
      driftTolerance = allowedError(replayed, persisted);
    }
  }
  const maxBucketDrift: BucketDriftDiagnostic = {
    absolute: driftBucket === null ? null : maximumDrift,
    bucketIndex: driftBucket,
    replayed: driftReplayed,
    persisted: driftPersisted,
    tolerance: driftTolerance,
    exceedsTolerance:
      driftBucket === null || driftTolerance === null || maximumDrift > driftTolerance,
  };

  return maxBucketDrift;
}

function analyzeHoldings(
  market: ReplayMarketInput,
  holdings: readonly ReplayHoldingInput[],
  stateFindings: StateFinding[],
) {
  const negativeHoldings: NegativeHoldingFinding[] = [];
  for (const holding of holdings) {
    if (holding.h.length !== market.nBuckets) {
      stateFindings.push({
        code: "INVALID_VECTOR_LENGTH",
        detail: `holding for user ${holding.userId} has ${holding.h.length} buckets; expected ${market.nBuckets}`,
      });
    }
    holding.h.forEach((value, bucketIndex) => {
      if (!Number.isFinite(value)) {
        stateFindings.push({
          code: "NONFINITE_VECTOR_VALUE",
          detail: `holding for user ${holding.userId} is non-finite at bucket ${bucketIndex}`,
        });
      } else if (value < -EPS) {
        negativeHoldings.push({ userId: holding.userId, bucketIndex, value });
      }
    });
  }

  return negativeHoldings;
}

function analyzeMarkCardinality(
  trades: readonly ReplayTradeInput[],
  marksByTradeId: ReadonlyMap<string, ReplayMarkInput[]>,
) {
  const tradeMarkCardinality: TradeMarkCardinalityFinding[] = [];
  for (const trade of trades) {
    const linked = marksByTradeId.get(trade.id) ?? [];
    const tradeSequence = parseInteger(trade.marketSequence);
    const tradeTimestamp = finiteTimestamp(trade.createdAt);
    let matchingMarkCount = 0;
    for (const mark of linked) {
      const markSequence = parseInteger(mark.marketSequence);
      const markTimestamp = finiteTimestamp(mark.timestamp);
      if (
        tradeSequence !== null &&
        markSequence === tradeSequence &&
        tradeTimestamp !== null &&
        markTimestamp === tradeTimestamp &&
        numbersAgree(mark.value, trade.metricAfter)
      ) {
        matchingMarkCount += 1;
      }
    }
    if (matchingMarkCount !== 1) {
      tradeMarkCardinality.push({
        tradeId: trade.id,
        marketSequence: trade.marketSequence,
        matchingMarkCount,
        linkedMarkCount: linked.length,
        linkedMarkSequences: linked.map((mark) => mark.marketSequence),
      });
    }
  }

  return tradeMarkCardinality;
}

function checkTradeMark(
  mark: ReplayMarkInput,
  tradesById: ReadonlyMap<string, ReplayTradeInput[]>,
  tradesBySequence: ReadonlyMap<string, ReplayTradeInput[]>,
  tradeMarkDisagreements: TradeMarkDisagreement[],
): void {
  const markSequence = parseInteger(mark.marketSequence);
  if (markSequence === 0n) {
    if (mark.tradeId !== null) {
      tradeMarkDisagreements.push({
        markSequence: mark.marketSequence,
        markTradeId: mark.tradeId,
        tradeSequence: null,
        expectedTradeId: null,
        fields: ["trade_id"],
      });
    }
    return;
  }

  const sequenceCandidates =
    markSequence === null ? [] : (tradesBySequence.get(markSequence.toString()) ?? []);
  const idCandidates = mark.tradeId === null ? [] : (tradesById.get(mark.tradeId) ?? []);
  const sequenceTrade = sequenceCandidates.length === 1 ? sequenceCandidates[0] : undefined;
  const linkedTrade = idCandidates.length === 1 ? idCandidates[0] : undefined;
  const trade = sequenceTrade ?? linkedTrade;
  if (trade === undefined) {
    tradeMarkDisagreements.push({
      markSequence: mark.marketSequence,
      markTradeId: mark.tradeId,
      tradeSequence: null,
      expectedTradeId: null,
      fields: ["trade_not_found"],
    });
    return;
  }

  const fields: TradeMarkDisagreementField[] = [];
  const tradeSequence = parseInteger(trade.marketSequence);
  const linkedTradeSequence =
    linkedTrade === undefined ? null : parseInteger(linkedTrade.marketSequence);
  const markTimestamp = finiteTimestamp(mark.timestamp);
  const tradeTimestamp = finiteTimestamp(trade.createdAt);
  if (sequenceTrade !== undefined && mark.tradeId !== sequenceTrade.id) {
    fields.push("trade_id");
  }
  if (
    markSequence === null ||
    tradeSequence === null ||
    markSequence !== tradeSequence ||
    (linkedTrade !== undefined &&
      (linkedTradeSequence === null || markSequence !== linkedTradeSequence))
  ) {
    fields.push("market_sequence");
  }
  if (markTimestamp === null || tradeTimestamp === null || markTimestamp !== tradeTimestamp) {
    fields.push("timestamp");
  }
  if (!numbersAgree(mark.value, trade.metricAfter)) fields.push("metric");
  if (fields.length > 0) {
    tradeMarkDisagreements.push({
      markSequence: mark.marketSequence,
      markTradeId: mark.tradeId,
      tradeSequence: trade.marketSequence,
      expectedTradeId: trade.id,
      fields,
    });
  }
}

function analyzeTradeMarks(trades: readonly ReplayTradeInput[], marks: readonly ReplayMarkInput[]) {
  const tradesById = new Map<string, ReplayTradeInput[]>();
  const tradesBySequence = new Map<string, ReplayTradeInput[]>();
  for (const trade of trades) {
    const idRows = tradesById.get(trade.id) ?? [];
    idRows.push(trade);
    tradesById.set(trade.id, idRows);
    const parsed = parseInteger(trade.marketSequence);
    if (parsed !== null) {
      const sequence = parsed.toString();
      const sequenceRows = tradesBySequence.get(sequence) ?? [];
      sequenceRows.push(trade);
      tradesBySequence.set(sequence, sequenceRows);
    }
  }

  const marksByTradeId = new Map<string, ReplayMarkInput[]>();
  for (const mark of marks) {
    if (mark.tradeId !== null) {
      const rows = marksByTradeId.get(mark.tradeId) ?? [];
      rows.push(mark);
      marksByTradeId.set(mark.tradeId, rows);
    }
  }

  const tradeMarkCardinality = analyzeMarkCardinality(trades, marksByTradeId);
  const tradeMarkDisagreements: TradeMarkDisagreement[] = [];
  for (const mark of marks)
    checkTradeMark(mark, tradesById, tradesBySequence, tradeMarkDisagreements);

  return { tradeMarkCardinality, tradeMarkDisagreements };
}

function analyzeTimestampOrder(marks: readonly ReplayMarkInput[]) {
  const timestampInversions: TimestampInversionFinding[] = [];
  const orderedMarks = parseAndOrder(marks, (mark) => mark.marketSequence).ordered;
  let latestPrior: ParsedSequence<ReplayMarkInput> | undefined;
  for (const current of orderedMarks) {
    const currentTimestamp = finiteTimestamp(current.row.timestamp);
    if (currentTimestamp === null) continue;
    if (latestPrior !== undefined) {
      const priorTimestamp = finiteTimestamp(latestPrior.row.timestamp);
      if (
        priorTimestamp !== null &&
        current.value > latestPrior.value &&
        currentTimestamp < priorTimestamp
      ) {
        timestampInversions.push({
          earlierSequence: latestPrior.value.toString(),
          earlierTimestamp: isoTimestamp(latestPrior.row.timestamp),
          laterSequence: current.value.toString(),
          laterTimestamp: isoTimestamp(current.row.timestamp),
        });
      }
      if (priorTimestamp !== null && currentTimestamp >= priorTimestamp) {
        latestPrior = current;
      }
    } else {
      latestPrior = current;
    }
  }

  return timestampInversions;
}

function analyzeMarket(
  market: ReplayMarketInput,
  trades: readonly ReplayTradeInput[],
  marks: readonly ReplayMarkInput[],
  holdings: readonly ReplayHoldingInput[],
  positions: readonly ReplayForwardPositionInput[] = [],
): MarketReplayDiagnostics {
  const stateFindings: StateFinding[] = [];
  const parsedLastSequence = parseInteger(market.lastMarketSequence);
  const validLastSequence =
    parsedLastSequence !== null && parsedLastSequence >= 0n ? parsedLastSequence : null;
  if (validLastSequence === null) {
    stateFindings.push({
      code: "INVALID_MARKET_SEQUENCE",
      detail: `last_market_sequence is ${market.lastMarketSequence}`,
    });
  }

  if (
    market.nBuckets <= 0 ||
    market.initialQ.length !== market.nBuckets ||
    market.q.length !== market.nBuckets
  ) {
    stateFindings.push({
      code: "INVALID_VECTOR_LENGTH",
      detail: `expected ${market.nBuckets} buckets, initial_q has ${market.initialQ.length}, q has ${market.q.length}`,
    });
  }
  if (!Number.isFinite(market.b) || market.b <= 0) {
    stateFindings.push({ code: "INVALID_LIQUIDITY", detail: `b is ${String(market.b)}` });
  }

  const isForward = market.metricKind === "forward_ln";
  const replayed = replayTrades(market, trades, stateFindings, isForward);
  const replayedQ = replayed.q;
  const tradeEconomics = replayed.tradeEconomics;
  const forwardFindings = isForward ? analyzeForwardBook(market, trades, positions) : [];

  const maxBucketDrift = analyzeBucketDrift(market, replayedQ, stateFindings);

  // A forward's q is open notional, not LMSR quantities: it has no PMF.
  const pmfNormalizationError = isForward ? 0 : pmfError(market, stateFindings);

  const negativeHoldings = analyzeHoldings(market, holdings, stateFindings);

  const tradeSequences = analyzeSequences(
    trades.map((trade) => trade.marketSequence),
    1n,
    validLastSequence,
  );
  const markSequences = analyzeSequences(
    marks.map((mark) => mark.marketSequence),
    0n,
    validLastSequence,
  );

  const { tradeMarkCardinality, tradeMarkDisagreements } = analyzeTradeMarks(trades, marks);

  const timestampInversions = analyzeTimestampOrder(marks);

  const passed =
    stateFindings.length === 0 &&
    !maxBucketDrift.exceedsTolerance &&
    pmfNormalizationError !== null &&
    pmfNormalizationError <= EPS &&
    negativeHoldings.length === 0 &&
    tradeEconomics.length === 0 &&
    tradeSequences.passed &&
    markSequences.passed &&
    tradeMarkCardinality.length === 0 &&
    tradeMarkDisagreements.length === 0 &&
    timestampInversions.length === 0 &&
    forwardFindings.length === 0;

  return {
    marketId: market.id,
    companySlug: market.companySlug,
    stateFindings,
    maxBucketDrift,
    pmfNormalizationError,
    negativeHoldings,
    tradeEconomics,
    tradeSequences,
    markSequences,
    tradeMarkCardinality,
    tradeMarkDisagreements,
    timestampInversions,
    forwardFindings,
    mmCashFlowCents: market.mmCashFlowCents,
    roundingReserveCents: market.roundingReserveCents,
    passed,
  };
}

function sumIntegerStrings(values: readonly { readonly label: string; readonly value: string }[]): {
  total: bigint | null;
  invalid: string[];
} {
  let total = 0n;
  const invalid: string[] = [];
  for (const { label, value } of values) {
    const parsed = parseInteger(value);
    if (parsed === null) {
      invalid.push(`${label}: ${value}`);
    } else {
      total += parsed;
    }
  }
  return { total: invalid.length === 0 ? total : null, invalid };
}

function analyzeCash(snapshot: ReplaySnapshot): CashReconciliationDiagnostics {
  const seedPerUser = BigInt(INITIAL_USER_BALANCE_CENTS);
  const seededBalance = seedPerUser * BigInt(snapshot.users.length);
  const userCash = sumIntegerStrings(
    snapshot.users.map((user) => ({ label: `user ${user.id}`, value: user.cashBalanceCents })),
  );
  const mmCashFlow = sumIntegerStrings(
    snapshot.markets.map((market) => ({
      label: `market ${market.id} MM cash flow`,
      value: market.mmCashFlowCents,
    })),
  );
  const roundingReserve = sumIntegerStrings(
    snapshot.markets.map((market) => ({
      label: `market ${market.id} rounding reserve`,
      value: market.roundingReserveCents,
    })),
  );
  const invalidValues = [...userCash.invalid, ...mmCashFlow.invalid, ...roundingReserve.invalid];
  const difference =
    userCash.total === null || mmCashFlow.total === null
      ? null
      : userCash.total + mmCashFlow.total - seededBalance;

  return {
    seedBalancePerUserCents: seedPerUser.toString(),
    userCount: snapshot.users.length,
    seededBalanceCents: seededBalance.toString(),
    currentUserCashCents: userCash.total?.toString() ?? null,
    marketMakerCashFlowCents: mmCashFlow.total?.toString() ?? null,
    roundingReserveCents: roundingReserve.total?.toString() ?? null,
    differenceCents: difference?.toString() ?? null,
    formula: "current_user_cash_cents + market_maker_cash_flow_cents - seeded_balance_cents",
    roundingReserveAccounting:
      "Rounding reserve is reported separately and excluded from the difference because user cash and MM flow both record the same quantized transfers.",
    invalidValues,
    passed: invalidValues.length === 0 && difference === 0n,
  };
}

export function analyzeReplay(snapshot: ReplaySnapshot): ReplayDiagnostics {
  const tradesByMarket = new Map<string, ReplayTradeInput[]>();
  for (const trade of snapshot.trades) {
    const rows = tradesByMarket.get(trade.marketId) ?? [];
    rows.push(trade);
    tradesByMarket.set(trade.marketId, rows);
  }
  const marksByMarket = new Map<string, ReplayMarkInput[]>();
  for (const mark of snapshot.marks) {
    const rows = marksByMarket.get(mark.marketId) ?? [];
    rows.push(mark);
    marksByMarket.set(mark.marketId, rows);
  }
  const holdingsByMarket = new Map<string, ReplayHoldingInput[]>();
  for (const holding of snapshot.holdings) {
    const rows = holdingsByMarket.get(holding.marketId) ?? [];
    rows.push(holding);
    holdingsByMarket.set(holding.marketId, rows);
  }

  const positionsByMarket = new Map<string, ReplayForwardPositionInput[]>();
  for (const position of snapshot.forwardPositions ?? []) {
    const rows = positionsByMarket.get(position.marketId) ?? [];
    rows.push(position);
    positionsByMarket.set(position.marketId, rows);
  }

  const marketDiagnostics = snapshot.markets.map((market) =>
    analyzeMarket(
      market,
      tradesByMarket.get(market.id) ?? [],
      marksByMarket.get(market.id) ?? [],
      holdingsByMarket.get(market.id) ?? [],
      positionsByMarket.get(market.id) ?? [],
    ),
  );
  const cashReconciliation = analyzeCash(snapshot);
  let maxBucketDrift: number | null = null;
  let maxPmfNormalizationError: number | null = null;
  for (const market of marketDiagnostics) {
    const drift = market.maxBucketDrift.absolute;
    if (drift !== null && (maxBucketDrift === null || drift > maxBucketDrift)) {
      maxBucketDrift = drift;
    }
    const pmfError = market.pmfNormalizationError;
    if (
      pmfError !== null &&
      (maxPmfNormalizationError === null || pmfError > maxPmfNormalizationError)
    ) {
      maxPmfNormalizationError = pmfError;
    }
  }
  const summary: ReplaySummary = {
    marketCount: marketDiagnostics.length,
    failedMarketCount: marketDiagnostics.filter((market) => !market.passed).length,
    maxBucketDrift,
    maxPmfNormalizationError,
    negativeHoldingCount: marketDiagnostics.reduce(
      (total, market) => total + market.negativeHoldings.length,
      0,
    ),
    tradeEconomicsFailureCount: marketDiagnostics.reduce(
      (total, market) => total + market.tradeEconomics.length,
      0,
    ),
    sequenceFailureCount: marketDiagnostics.reduce(
      (total, market) =>
        total + Number(!market.tradeSequences.passed) + Number(!market.markSequences.passed),
      0,
    ),
    tradeMarkCardinalityFailureCount: marketDiagnostics.reduce(
      (total, market) => total + market.tradeMarkCardinality.length,
      0,
    ),
    tradeMarkDisagreementCount: marketDiagnostics.reduce(
      (total, market) => total + market.tradeMarkDisagreements.length,
      0,
    ),
    timestampInversionCount: marketDiagnostics.reduce(
      (total, market) => total + market.timestampInversions.length,
      0,
    ),
  };

  return {
    tolerance: EPS,
    markets: marketDiagnostics,
    cashReconciliation,
    summary,
    passed: cashReconciliation.passed && marketDiagnostics.every((market) => market.passed),
  };
}

async function loadSnapshot(db: Transaction<Database>): Promise<ReplaySnapshot> {
  const markets = await db
    .selectFrom("markets")
    .innerJoin("companies", "companies.id", "markets.company_id")
    .select([
      "markets.id",
      "companies.slug as company_slug",
      "markets.metric_kind",
      "markets.n_buckets",
      "markets.b",
      "markets.initial_q",
      "markets.q",
      "markets.last_market_sequence",
      "markets.mm_cash_flow_cents",
      "markets.rounding_reserve_cents",
    ])
    .orderBy("companies.slug", "asc")
    .orderBy("markets.created_at", "asc")
    .execute();
  const trades = await db
    .selectFrom("trades")
    .select([
      "id",
      "market_id",
      "market_sequence",
      "action",
      "contract_side",
      "delta",
      "cash_amount_cents",
      "redemption_quantity",
      "redemption_cents",
      "metric_after",
      "created_at",
    ])
    .orderBy("market_id", "asc")
    .orderBy("market_sequence", "asc")
    .execute();
  const marks = await db
    .selectFrom("marks")
    .select(["market_id", "market_sequence", "trade_id", "ts", "value"])
    .orderBy("market_id", "asc")
    .orderBy("market_sequence", "asc")
    .execute();
  const holdings = await db
    .selectFrom("holdings")
    .select(["user_id", "market_id", "h"])
    .orderBy("market_id", "asc")
    .orderBy("user_id", "asc")
    .execute();
  const users = await db
    .selectFrom("users")
    .select(["id", "cash_balance_cents"])
    .orderBy("id", "asc")
    .execute();
  const positions = await db
    .selectFrom("forward_positions")
    .innerJoin("markets", "markets.instrument_id", "forward_positions.instrument_id")
    .select([
      "forward_positions.id",
      "markets.id as market_id",
      "forward_positions.trade_id",
      "forward_positions.side",
      "forward_positions.notional_cents",
      "forward_positions.entry_ln",
      "forward_positions.collateral_cents",
      "forward_positions.settled_at",
      "forward_positions.settle_ln",
      "forward_positions.payout_cents",
      "forward_positions.voided_at",
    ])
    .orderBy("forward_positions.opened_at", "asc")
    .orderBy("forward_positions.id", "asc")
    .execute();

  return {
    markets: markets.map((market) => ({
      id: market.id,
      companySlug: market.company_slug,
      metricKind: market.metric_kind,
      nBuckets: market.n_buckets,
      b: market.b,
      initialQ: market.initial_q,
      q: market.q,
      lastMarketSequence: market.last_market_sequence,
      mmCashFlowCents: market.mm_cash_flow_cents,
      roundingReserveCents: market.rounding_reserve_cents,
    })),
    trades: trades.map((trade) => ({
      id: trade.id,
      marketId: trade.market_id,
      marketSequence: trade.market_sequence,
      action: trade.action,
      contractSide: trade.contract_side,
      delta: trade.delta,
      cashAmountCents: trade.cash_amount_cents,
      redemptionQuantity: trade.redemption_quantity,
      redemptionCents: trade.redemption_cents,
      metricAfter: trade.metric_after,
      createdAt: trade.created_at,
    })),
    marks: marks.map((mark) => ({
      marketId: mark.market_id,
      marketSequence: mark.market_sequence,
      tradeId: mark.trade_id,
      timestamp: mark.ts,
      value: mark.value,
    })),
    holdings: holdings.map((holding) => ({
      userId: holding.user_id,
      marketId: holding.market_id,
      h: holding.h,
    })),
    users: users.map((user) => ({
      id: user.id,
      cashBalanceCents: user.cash_balance_cents,
    })),
    forwardPositions: positions.map((position) => ({
      id: position.id,
      marketId: position.market_id,
      tradeId: position.trade_id,
      side: position.side,
      notionalCents: position.notional_cents,
      entryLn: position.entry_ln,
      collateralCents: position.collateral_cents,
      settled: position.settled_at !== null,
      settleLn: position.settle_ln,
      payoutCents: position.payout_cents,
      voided: position.voided_at !== null,
    })),
  };
}

export async function verifyReplay(db: Kysely<Database>): Promise<ReplayDiagnostics> {
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(loadSnapshot)
    .then(analyzeReplay);
}
