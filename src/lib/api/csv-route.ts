import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import { getRuntimeDatabase } from "../db/runtime.js";
import type { Database } from "../db/schema.js";
import { logReadRequest, logUnexpectedError } from "../logging/server-log.js";
import type { CsvTable } from "../services/index/data-csv.js";
import { consumeRefQuota } from "../services/ref-access.js";
import { csvLine, csvRecord } from "../tradeables/csv.js";
import { type ErrorCode, isServiceError } from "./errors.js";
import { assertOnlyQueryParameters } from "./pagination.js";
import { REF_CACHE_SECONDS } from "./ref-route.js";
import { errorCode, jsonError, jsonUnexpectedError, REQUEST_ID_HEADER } from "./response.js";

/** Where the datasets' licence is served (public/data/LICENSE). */
export const DATA_LICENSE_PATH = "/data/LICENSE";

export interface CsvRouteContext {
  readonly db: Kysely<Database>;
  readonly searchParams: URLSearchParams;
  readonly now: Date;
}

/**
 * A CSV download generated from the tables: the `ref` quota and cache policy
 * of /api/ref/* (60 s shared cache when anonymous, private when keyed),
 * `Content-Type: text/csv`, a `Link` to the licence, and the versions the
 * rows were produced under as `OpenMarket-*` headers. The body streams one
 * database batch at a time. A failure before the first batch is the JSON
 * error envelope; one after it ends the stream with an error, and the client
 * sees a truncated download rather than a partial file presented as whole.
 */
export async function withCsvRoute(
  request: Request,
  allowedParameters: readonly string[],
  open: (context: CsvRouteContext) => CsvTable,
): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = performance.now();
  let response: Response;
  let failureCode: ErrorCode | "INTERNAL_ERROR" | undefined;
  try {
    const url = new URL(request.url);
    assertOnlyQueryParameters(url.searchParams, allowedParameters);
    await consumeRefQuota(getRuntimeDatabase, request);
    const table = open({
      get db() {
        return getRuntimeDatabase();
      },
      searchParams: url.searchParams,
      now: new Date(),
    });
    const iterator = table.batches[Symbol.asyncIterator]();
    const first = await iterator.next();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(csvLine(table.columns)));
        if (first.done) controller.close();
        else controller.enqueue(encoder.encode(first.value.map(csvRecord).join("")));
      },
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(next.value.map(csvRecord).join("")));
        } catch (error: unknown) {
          logUnexpectedError(requestId, error);
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    });
    const keyed = request.headers.has("authorization");
    const headers = new Headers({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${table.filename}"`,
      "Cache-Control": keyed
        ? "private, no-store"
        : `public, max-age=${REF_CACHE_SECONDS}, s-maxage=${REF_CACHE_SECONDS}`,
      Vary: "Authorization",
      Link: `<${new URL(DATA_LICENSE_PATH, url.origin).href}>; rel="license"`,
      [REQUEST_ID_HEADER]: requestId,
    });
    for (const [name, value] of Object.entries(table.versions)) {
      headers.set(`OpenMarket-${name.replaceAll("_", "-")}`, value);
    }
    response = new Response(body, { headers });
  } catch (error: unknown) {
    failureCode = errorCode(error);
    if (isServiceError(error)) response = jsonError(error, requestId);
    else {
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
