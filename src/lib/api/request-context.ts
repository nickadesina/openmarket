import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { getRuntimeDatabase } from "../db/runtime.js";
import type { Database } from "../db/schema.js";
import { logReadRequest, logUnexpectedError } from "../logging/server-log.js";
import { type ErrorCode, isServiceError } from "./errors.js";
import { errorCode, jsonError, jsonUnexpectedError, REQUEST_ID_HEADER } from "./response.js";

export interface ReadRouteContext {
  readonly requestId: string;
  readonly db: Kysely<Database>;
}

export type ReadRouteHandler = (context: ReadRouteContext) => Response | Promise<Response>;

export interface ReadRouteOptions {
  /** Public, user-agnostic reads may be shared-cached this long; errors are never cached. */
  readonly cacheSeconds?: number;
}

export async function withReadRoute(
  request: Request,
  handler: ReadRouteHandler,
  options: ReadRouteOptions = {},
): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = performance.now();
  let response: Response;
  let failureCode: ErrorCode | "INTERNAL_ERROR" | undefined;

  const context: ReadRouteContext = {
    requestId,
    get db() {
      return getRuntimeDatabase();
    },
  };

  try {
    response = await handler(context);
    response.headers.set("Content-Type", "application/json; charset=utf-8");
    response.headers.set(
      "Cache-Control",
      options.cacheSeconds === undefined
        ? "no-store"
        : `public, max-age=${options.cacheSeconds}, s-maxage=${options.cacheSeconds}`,
    );
    response.headers.set(REQUEST_ID_HEADER, requestId);
  } catch (error: unknown) {
    failureCode = errorCode(error);
    if (isServiceError(error)) {
      response = jsonError(error, requestId);
    } else {
      logUnexpectedError(requestId, error);
      response = jsonUnexpectedError(requestId);
    }
  }

  logReadRequest({
    requestId,
    method: request.method,
    pathname: new URL(request.url).pathname,
    status: response.status,
    durationMs: performance.now() - startedAt,
    ...(failureCode === undefined ? {} : { errorCode: failureCode }),
  });

  return response;
}
