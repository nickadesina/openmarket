import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { ZodType } from "zod";
import { getRuntimeDatabase } from "../db/runtime.js";
import type { Database } from "../db/schema.js";
import { logUnexpectedError } from "../logging/server-log.js";
import { assertAllowedOrigin } from "../security/origin.js";
import { isServiceError, ServiceError } from "./errors.js";
import { jsonError, jsonUnexpectedError, REQUEST_ID_HEADER } from "./response.js";

export const MUTATION_CONTENT_TYPE = "application/json";

export interface MutationRouteContext {
  readonly requestId: string;
  readonly db: Kysely<Database>;
}

export type MutationRouteHandler = (context: MutationRouteContext) => Response | Promise<Response>;

function assertMutationRequest(request: Request): void {
  if (request.headers.get("content-type") !== MUTATION_CONTENT_TYPE) {
    throw new ServiceError(
      "INVALID_INPUT",
      `Content-Type must be exactly ${MUTATION_CONTENT_TYPE}.`,
    );
  }

  assertAllowedOrigin(request.headers.get("origin"), process.env);
}

async function readBoundedJson(request: Request, maximumBytes: number): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maximumBytes) {
    throw new ServiceError("INVALID_INPUT", "Request body is too large.");
  }
  const reader = request.body?.getReader();
  if (reader === undefined) {
    throw new ServiceError("INVALID_INPUT", "Request body is required.");
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new ServiceError("INVALID_INPUT", "Request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function parseMutationBody<T>(
  request: Request,
  schema: ZodType<T>,
  maximumBytes: number,
): Promise<T> {
  let body: unknown;
  try {
    body = await readBoundedJson(request, maximumBytes);
  } catch {
    throw new ServiceError("INVALID_INPUT", "Request body is invalid.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ServiceError("INVALID_INPUT", "Request body is invalid.");
  }
  return parsed.data;
}

export async function withMutationRoute(
  request: Request,
  handler: MutationRouteHandler,
): Promise<Response> {
  const requestId = randomUUID();
  const context: MutationRouteContext = {
    requestId,
    get db() {
      return getRuntimeDatabase();
    },
  };

  let response: Response;
  try {
    assertMutationRequest(request);
    response = await handler(context);
    response.headers.set("Content-Type", "application/json; charset=utf-8");
    response.headers.set("Cache-Control", "no-store");
    response.headers.set(REQUEST_ID_HEADER, requestId);
  } catch (error: unknown) {
    if (isServiceError(error)) {
      response = jsonError(error, requestId);
    } else {
      logUnexpectedError(requestId, error);
      response = jsonUnexpectedError(requestId);
    }
  }

  return response;
}
