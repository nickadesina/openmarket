import type { ErrorCode } from "../api/errors.js";

export interface ReadRequestLog {
  readonly requestId: string;
  readonly method: string;
  readonly pathname: string;
  readonly status: number;
  readonly durationMs: number;
  readonly errorCode?: ErrorCode | "INTERNAL_ERROR";
}

export function logReadRequest(event: ReadRequestLog): void {
  const entry = {
    level: event.status >= 500 ? "error" : "info",
    event: "read_request",
    requestId: event.requestId,
    method: event.method,
    pathname: event.pathname,
    status: event.status,
    durationMs: Math.round(event.durationMs * 100) / 100,
    ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
  };

  console.info(JSON.stringify(entry));
}

/**
 * Unexpected (non-ServiceError) failures are answered with an opaque
 * INTERNAL_ERROR envelope; this is the only place their cause is recorded.
 * The entry carries the request ID so a client-visible 500 can be matched to
 * its cause without ever echoing request bodies, cookies, or secrets.
 */
export function logUnexpectedError(requestId: string, error: unknown): void {
  const cause =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: "UnknownThrown", message: String(error) };
  console.error(JSON.stringify({ level: "error", event: "unexpected_error", requestId, ...cause }));
}
