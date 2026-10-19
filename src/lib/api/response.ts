import { randomUUID } from "node:crypto";

import type { ErrorCode, ErrorDetails } from "./errors.js";
import { isServiceError, type ServiceError } from "./errors.js";

export const REQUEST_ID_HEADER = "X-Request-ID";

export interface JsonResponseInit extends ResponseInit {
  readonly requestId?: string;
}

export interface ErrorEnvelope {
  readonly error: {
    readonly code: ErrorCode | "INTERNAL_ERROR";
    readonly message: string;
    readonly details: ErrorDetails;
  };
}

const SERVICE_ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  INVALID_INPUT: 400,
  USER_REQUIRED: 401,
  MARKET_NOT_FOUND: 404,
  MARKET_SETTLED: 409,
  INSUFFICIENT_CASH: 409,
  INSUFFICIENT_HOLDINGS: 409,
  PRICE_MOVED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  ADMIN_REQUIRED: 401,
  COMMENT_NOT_FOUND: 404,
  ACCOUNT_CHANGED: 409,
  RATE_LIMITED: 429,
  POSTING_UNAVAILABLE: 503,
  QUESTION_NOT_FOUND: 404,
  QUESTION_NOT_OPEN: 409,
  QUESTION_STATE: 409,
  ACCOUNT_TOO_NEW: 403,
  FORECASTER_NOT_FOUND: 404,
  SIGN_IN_UNAVAILABLE: 503,
  FORECAST_NOT_FOUND: 404,
};

function jsonBody(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (typeof nestedValue === "bigint") {
      return nestedValue.toString();
    }
    if (nestedValue instanceof Date) {
      return nestedValue.toISOString();
    }
    return nestedValue;
  });
  return serialized ?? "null";
}

function responseHeaders(suppliedHeaders: HeadersInit | undefined, requestId: string): Headers {
  const headers = new Headers(suppliedHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set(REQUEST_ID_HEADER, requestId);
  return headers;
}

export function jsonSuccess<T>(data: T, init: JsonResponseInit = {}): Response {
  const { requestId = randomUUID(), headers: suppliedHeaders, ...responseInit } = init;

  return new Response(jsonBody(data), {
    ...responseInit,
    headers: responseHeaders(suppliedHeaders, requestId),
  });
}

export function jsonError(error: ServiceError, requestId: string): Response {
  const envelope: ErrorEnvelope = {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  };

  const headers = responseHeaders(undefined, requestId);
  if (error.code === "RATE_LIMITED" && typeof error.details.retryAfterSeconds === "number") {
    headers.set("Retry-After", String(error.details.retryAfterSeconds));
  }

  return new Response(jsonBody(envelope), {
    status: SERVICE_ERROR_STATUS[error.code],
    headers,
  });
}

export function jsonUnexpectedError(requestId: string): Response {
  const envelope: ErrorEnvelope = {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      details: {},
    },
  };

  return new Response(jsonBody(envelope), {
    status: 500,
    headers: responseHeaders(undefined, requestId),
  });
}

export function errorCode(error: unknown): ErrorCode | "INTERNAL_ERROR" {
  return isServiceError(error) ? error.code : "INTERNAL_ERROR";
}
