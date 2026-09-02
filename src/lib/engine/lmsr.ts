import { MIN_QUANTITY } from "./types.js";

interface NormalizedState {
  readonly values: readonly number[];
  readonly b: number;
  readonly maxQ: number;
  readonly sumExp: number;
  readonly logSumExp: number;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function assertLiquidity(b: number): void {
  assertFinite(b, "b");
  if (b <= 0) {
    throw new RangeError("b must be positive");
  }
}

function normalizeState(q: readonly number[], b: number): NormalizedState {
  assertLiquidity(b);
  if (q.length === 0) {
    throw new RangeError("q must not be empty");
  }

  let maxQ = -Infinity;
  for (let index = 0; index < q.length; index += 1) {
    const value = q[index]!;
    assertFinite(value, `q[${index}]`);
    if (value > maxQ) {
      maxQ = value;
    }
  }

  const values = new Array<number>(q.length);
  let sumExp = 0;
  for (let index = 0; index < q.length; index += 1) {
    const normalized = q[index]! - maxQ;
    values[index] = normalized;
    sumExp += Math.exp(normalized / b);
  }

  return { values, b, maxQ, sumExp, logSumExp: Math.log(sumExp) };
}

function assertFiniteResult(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} is outside the finite numeric range`);
  }
  return value;
}

function shiftedCost(state: NormalizedState, shifts: readonly number[]): number {
  if (shifts.length !== state.values.length) {
    throw new RangeError("q and delta must have equal lengths");
  }

  let maxShifted = -Infinity;
  for (let index = 0; index < shifts.length; index += 1) {
    const shift = shifts[index]!;
    assertFinite(shift, `delta[${index}]`);
    const shifted = state.values[index]! + shift;
    if (shifted > maxShifted) {
      maxShifted = shifted;
    }
  }

  let sumExp = 0;
  for (let index = 0; index < shifts.length; index += 1) {
    const shifted = state.values[index]! + shifts[index]!;
    sumExp += Math.exp((shifted - maxShifted) / state.b);
  }

  const result = maxShifted + state.b * (Math.log(sumExp) - state.logSumExp);
  return assertFiniteResult(result, "trade cost");
}

function validateMask(mask: readonly boolean[], expectedLength: number): void {
  if (mask.length !== expectedLength) {
    throw new RangeError("q and mask must have equal lengths");
  }

  let includesBucket = false;
  for (let index = 0; index < mask.length; index += 1) {
    if (typeof mask[index] !== "boolean") {
      throw new RangeError(`mask[${index}] must be boolean`);
    }
    includesBucket ||= mask[index]!;
  }
  if (!includesBucket) {
    throw new RangeError("mask must include at least one bucket");
  }
}

function maskedBuyCost(state: NormalizedState, mask: readonly boolean[], quantity: number): number {
  let maxShifted = -Infinity;
  for (let index = 0; index < state.values.length; index += 1) {
    const shifted = state.values[index]! + (mask[index] ? quantity : 0);
    if (shifted > maxShifted) {
      maxShifted = shifted;
    }
  }

  let sumExp = 0;
  for (let index = 0; index < state.values.length; index += 1) {
    const shifted = state.values[index]! + (mask[index] ? quantity : 0);
    sumExp += Math.exp((shifted - maxShifted) / state.b);
  }

  return assertFiniteResult(
    maxShifted + state.b * (Math.log(sumExp) - state.logSumExp),
    "buy cost",
  );
}

function assertSafeCents(cents: number, name: string): number {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`${name} is outside the safe integer cent range`);
  }
  return cents === 0 ? 0 : cents;
}

export function lmsrCost(q: readonly number[], b: number): number {
  const state = normalizeState(q, b);
  return assertFiniteResult(state.maxQ + state.b * state.logSumExp, "LMSR cost");
}

export function probabilities(q: readonly number[], b: number): number[] {
  const state = normalizeState(q, b);
  const result = new Array<number>(state.values.length);
  for (let index = 0; index < state.values.length; index += 1) {
    result[index] = Math.exp(state.values[index]! / state.b) / state.sumExp;
  }
  return result;
}

export function tradeCost(q: readonly number[], delta: readonly number[], b: number): number {
  return shiftedCost(normalizeState(q, b), delta);
}

export function quantizeBuyCostCents(costUsd: number): number {
  assertFinite(costUsd, "costUsd");
  if (costUsd < 0) {
    throw new RangeError("buy cost must not be negative");
  }
  return assertSafeCents(Math.ceil(costUsd * 100), "buy cost");
}

export function quantizeSellProceedsCents(costUsd: number): number {
  assertFinite(costUsd, "costUsd");
  if (costUsd > 0) {
    throw new RangeError("sell cost must not be positive");
  }
  return assertSafeCents(Math.floor(-costUsd * 100), "sell proceeds");
}

export function quantizeEntitlementCents(entitlementUsd: number): number {
  assertFinite(entitlementUsd, "entitlementUsd");
  if (entitlementUsd < 0) {
    throw new RangeError("entitlement must not be negative");
  }
  return assertSafeCents(Math.floor(entitlementUsd * 100 + 1e-6), "entitlement");
}

export function solveBuyQuantityForSpend(
  q: readonly number[],
  mask: readonly boolean[],
  b: number,
  spendCents: number,
): { quantity: number; costUsd: number; cashAmountCents: number } {
  const state = normalizeState(q, b);
  validateMask(mask, q.length);
  if (!Number.isSafeInteger(spendCents) || spendCents < 1) {
    throw new RangeError("spendCents must be a positive safe integer");
  }

  const spendUsd = spendCents / 100;
  let lower = 0;
  let upper = 1;
  while (maskedBuyCost(state, mask, upper) <= spendUsd) {
    upper *= 2;
    if (!Number.isFinite(upper)) {
      throw new RangeError("spend has no finite quantity solution");
    }
  }

  for (let iteration = 0; iteration < 30; iteration += 1) {
    const midpoint = lower + (upper - lower) / 2;
    if (maskedBuyCost(state, mask, midpoint) <= spendUsd) {
      lower = midpoint;
    } else {
      upper = midpoint;
    }
  }

  let quantityUnits = Math.floor(lower * 1_000_000);
  let quantity = quantityUnits / 1_000_000;
  let costUsd = maskedBuyCost(state, mask, quantity);
  let cashAmountCents = quantizeBuyCostCents(costUsd);

  while (quantityUnits > 0 && (costUsd > spendUsd || cashAmountCents > spendCents)) {
    quantityUnits -= 1;
    quantity = quantityUnits / 1_000_000;
    costUsd = maskedBuyCost(state, mask, quantity);
    cashAmountCents = quantizeBuyCostCents(costUsd);
  }

  if (quantity < MIN_QUANTITY || cashAmountCents === 0) {
    throw new RangeError("spend produces no transferable quantity");
  }

  return { quantity, costUsd, cashAmountCents };
}
