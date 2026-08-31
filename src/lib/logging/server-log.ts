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
