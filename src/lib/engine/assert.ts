/** Shared input guards for the pure engine's finite arithmetic. */
export function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

export function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be greater than zero`);
}

export function assertDate(value: Date, name: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
}

export function assertNonNegative(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) throw new RangeError(`${name} must not be negative`);
}
