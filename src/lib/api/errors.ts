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
  "COMMENT_NOT_FOUND",
  "ACCOUNT_CHANGED",
  "RATE_LIMITED",
  "POSTING_UNAVAILABLE",
  "QUESTION_NOT_FOUND",
  "QUESTION_NOT_OPEN",
  "QUESTION_STATE",
  "ACCOUNT_TOO_NEW",
  "FORECASTER_NOT_FOUND",
  "SIGN_IN_UNAVAILABLE",
  "FORECAST_NOT_FOUND",
  "USERNAME_TAKEN",
  "SIGN_IN_FAILED",
  "CAP_EXCEEDED",
  "PRICE_CLAMPED",
  "INSTRUMENT_CLOSED",
  "API_KEY_INVALID",
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
