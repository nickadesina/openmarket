export const ERROR_CODES = [
  "INVALID_INPUT",
  "USER_REQUIRED",
  "MARKET_NOT_FOUND",
  "MARKET_SETTLED",
  "INSUFFICIENT_CASH",
  "INSUFFICIENT_HOLDINGS",
  "PRICE_MOVED",
  "IDEMPOTENCY_CONFLICT",
  "ADMIN_REQUIRED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
export type ErrorDetails = Readonly<Record<string, unknown>>;

export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.details = details;
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}
