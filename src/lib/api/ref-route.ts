import { consumeRefQuota } from "../services/ref-access.js";
import { ServiceError } from "./errors.js";
import {
  assertOnlyQueryParameters,
  parseBoundedInteger,
  parseOptionalString,
} from "./pagination.js";
import { type ReadRouteContext, withReadRoute } from "./request-context.js";
import { jsonSuccess } from "./response.js";

/**
 * Every /api/ref/* route (v1 README D14, kept in v2): public, read-only, shared-cached for
 * 60 seconds for anonymous requests (keyed responses are private), and drawn from the caller's `ref` quota (its network's bucket,
 * or its API key's) after the query's names and values are validated and before any read.
 */
export const REF_CACHE_SECONDS = 60;

export interface RefRouteContext<Query = undefined> extends ReadRouteContext {
  readonly searchParams: URLSearchParams;
  readonly now: Date;
  /** The route's parsed query (and path values), validated before the quota is drawn. */
  readonly query: Query;
}

/**
 * The query a route accepts: the parameter names, and a parser that reads
 * and validates their values (and any path value). It runs before the quota
 * is drawn, so a malformed request costs the caller nothing.
 */
export interface RefQuery<Query> {
  readonly parameters: readonly string[];
  readonly parse: (searchParams: URLSearchParams) => Query;
}

/** Validates the query's names, then its values, before any quota or read. */
export function parseRefQuery<Query>(
  searchParams: URLSearchParams,
  spec: readonly string[] | RefQuery<Query>,
): Query {
  if (isQuerySpec(spec)) {
    assertOnlyQueryParameters(searchParams, spec.parameters);
    return spec.parse(searchParams);
  }
  assertOnlyQueryParameters(searchParams, spec);
  return undefined as Query;
}

function isQuerySpec<Query>(spec: readonly string[] | RefQuery<Query>): spec is RefQuery<Query> {
  return !Array.isArray(spec);
}

export async function withRefRoute<Query = undefined>(
  request: Request,
  spec: readonly string[] | RefQuery<Query>,
  handler: (context: RefRouteContext<Query>) => Promise<unknown> | unknown,
): Promise<Response> {
  const response = await withReadRoute(
    request,
    async (context) => {
      const searchParams = new URL(request.url).searchParams;
      const query = parseRefQuery(searchParams, spec);
      await consumeRefQuota(() => context.db, request);
      const body = await handler({
        requestId: context.requestId,
        // Lazy, as in withReadRoute: a route that reads nothing opens no pool.
        get db() {
          return context.db;
        },
        searchParams,
        now: new Date(),
        query,
      });
      return jsonSuccess(body, { requestId: context.requestId });
    },
    request.headers.has("authorization") ? {} : { cacheSeconds: REF_CACHE_SECONDS },
  );
  response.headers.set("Vary", "Authorization");
  if (response.ok && request.headers.has("authorization"))
    response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** `limit` on a paginated ref log: 1–1000, default 200. */
export function parseRefLimit(searchParams: URLSearchParams): number {
  return parseBoundedInteger(searchParams, "limit", {
    defaultValue: 200,
    minimum: 1,
    maximum: 1000,
  });
}

export function parseRefCursor(searchParams: URLSearchParams): string | undefined {
  return parseOptionalString(searchParams, "cursor", { maximumLength: 512 });
}

/** An optional ISO 8601 instant (`from`, `to`). */
export function parseRefInstant(searchParams: URLSearchParams, name: string): Date | undefined {
  const value = parseOptionalString(searchParams, name, { maximumLength: 40 });
  if (value === undefined) return undefined;
  const parsed = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/.test(value)
    ? new Date(value)
    : new Date(Number.NaN);
  if (Number.isNaN(parsed.getTime())) {
    throw new ServiceError("INVALID_INPUT", `Invalid ${name} query parameter.`, {
      parameter: name,
    });
  }
  return parsed;
}

/** An optional `include` naming one extra the route can add; anything else is INVALID_INPUT. */
export function parseRefInclude<const Value extends string>(
  searchParams: URLSearchParams,
  values: readonly Value[],
): Value | undefined {
  const value = parseOptionalString(searchParams, "include", { maximumLength: 40 });
  if (value === undefined) return undefined;
  if (!(values as readonly string[]).includes(value)) {
    throw new ServiceError("INVALID_INPUT", "Invalid include query parameter.", {
      parameter: "include",
      allowed: values,
    });
  }
  return value as Value;
}
