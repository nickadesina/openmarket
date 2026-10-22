# Part 3 — Read APIs

Part 3 consumes the verified mathematical and transaction layers in `PART1.md` and `PART2.md`. It adds a minimal Next.js App Router shell and public/authenticated read APIs. It intentionally excludes product UI, polling, quote/trade routes, admin routes, and deployment.

## Shared rules

- Read `/Users/nick/tmp/openmarket/TECHNICAL_DESIGN.md`, `PART1.md`, and `PART2.md` before editing.
- Database-backed route handlers export `runtime = "nodejs"`; no Edge runtime.
- Multi-query payloads run in one repeatable-read, read-only Kysely transaction.
- Dates serialize as ISO strings; bigint/numeric database values serialize as strings; never serialize JavaScript `bigint`.
- Route errors use the existing stable `ServiceError` envelope. No stack traces, SQL, secrets, cookies, request fingerprints, or idempotency keys.
- Read responses set `Cache-Control: no-store` and include a request ID.
- Runtime database access is lazy and reuses one pooled Kysely instance per warm process. Part 2’s pool cap remains `max: 2`.
- Do not duplicate Part 1 engine math or Part 2 portfolio/auth logic.

## Read-service contracts

Milestone 6 replaced the ladder read model with the listing read model (README D11):

- `listMarkets(db, options?) -> Promise<MarketListResult>`: every active listing, by open interest; each carries its live binary and forward quote (the `GET /api/instruments/[id]/quote` shape), the implied distribution, open interest, `model_version` and `rulebook_version`.
- `getMarket(db, slug, options?) -> Promise<ListingDetail>`: one listed name's view plus every epoch of both contracts by market id.
- `getMarks(db, marketId, range, options?) -> Promise<MarkHistory>`: one book's marks by market id, live or settled; ranges `1h|1d|1w|all`; timestamp then sequence order; raw for 1h/1d; final-observation time-bucket downsampling for 1w/all; a forward's current level is its latest model mid.
- `downsampleMarks(points, maxPoints) -> points`: pure, non-mutating, ordered first/last preserving final-observation buckets.
- `getActivity(db, options?) -> Promise<ActivityPage>`: global or slug-filtered public trades; opaque stable cursor; bounded page; no user/private/idempotency fields.

## Route contracts

- `GET /api/markets`
- `GET /api/markets/[slug]`
- `GET /api/markets/by-id/[marketId]/marks?range=1h|1d|1w|all`
- `GET /api/activity?slug=&cursor=&limit=`
- `GET /api/portfolio?offset=&limit=`

Portfolio identity comes only from the tournament session cookie, resolved to its paper account by `requireCurrentUserId` (README D1). Never accept user identity from query/body/headers.

## Response infrastructure

- `jsonSuccess(data, init?)` and `jsonError(error, requestId)` return `Response` objects with JSON content type, request ID, and no-store.
- `withReadRoute(request, handler)` or an equally small wrapper creates a request context, lazy database handle, duration log, and stable error mapping.
- Missing market -> `MARKET_NOT_FOUND`; missing/invalid session -> `USER_REQUIRED`; malformed query/cursor/range -> `INVALID_INPUT`.

## Completion gate

- Part 1 and Part 2 tests remain green.
- Strict TypeScript and `next build` pass without a database URL.
- Read service and route tests cover listings, binary/forward/settled books, ordering, open interest, tied timestamps, downsampling, activity privacy/pagination, portfolio session auth, JSON serialization, and error envelopes.
- PostgreSQL integration coverage extends the existing optional `DATABASE_URL_TEST` suite.
- The actual Next server is launched and database-independent routes/errors are exercised.
