import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { ZodType } from "zod";

import type { Database } from "../db/schema.js";
import { getRuntimeDatabase } from "../db/runtime.js";
import { assertAllowedOrigin } from "../security/origin.js";
import { ServiceError, isServiceError } from "./errors.js";
import {
  jsonError,
  jsonUnexpectedError,
  REQUEST_ID_HEADER,
} from "./response.js";

export const MUTATION_CONTENT_TYPE = "application/json";

export interface MutationRouteContext {
  readonly requestId: string;
  readonly db: Kysely<Database>;
}

export type MutationRouteHandler = (
  context: MutationRouteContext,
) => Response | Promise<Response>;

function assertMutationRequest(request: Request): void {
  if (request.headers.get("content-type") !== MUTATION_CONTENT_TYPE) {
    throw new ServiceError(
      "INVALID_INPUT",
      `Content-Type must be exactly ${MUTATION_CONTENT_TYPE}.`,
    );
  }

  assertAllowedOrigin(request.headers.get("origin"), process.env);
}

export async function parseMutationBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
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
    response = isServiceError(error)
      ? jsonError(error, requestId)
      : jsonUnexpectedError(requestId);
  }

  return response;
}
