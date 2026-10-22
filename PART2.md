# Part 2 — Persistence and Transactions

Part 2 consumes the verified mathematical core in `PART1.md`. It adds PostgreSQL persistence and pure service APIs, but intentionally excludes Next.js route handlers and UI.

## Required prior context

- Read `/Users/nick/tmp/openmarket/TECHNICAL_DESIGN.md`, especially sections 6 and 10–14, before editing.
- Reuse the engine exports in `src/lib/engine`; do not duplicate LMSR, grid, quantile or seeding math.
- Float vectors are application-zero-indexed and PostgreSQL arrays are PostgreSQL-one-indexed. Kysely must pass whole arrays rather than manually shifting their contents.
- Cash is integer cents. JSON-facing dollar values remain decimal strings at later route boundaries.

## Database contract

- `src/lib/db/schema.ts` exports `Database` and row/table types for `companies`, `markets`, `users`, `holdings`, `trades`, `marks`, and `settlements`.
- `src/lib/db/client.ts` exports `createPooledDatabase(connectionString?)`, `createDirectDatabase(connectionString?)`, and `destroyDatabase(db)`.
- Route/service pools use `max: 2`; migration and diagnostics use `DATABASE_URL_UNPOOLED`.
- Every lock, advisory lock, and state mutation remains inside one Kysely transaction callback.

## Service contracts

- `ensurePaperAccount(db, tournamentUserId)` opens, race-safely, or returns the tournament user's paper account with a $100,000 initial balance (README D1).
- `quoteMarket(db, input, userId?)` is read-only. Anonymous buys are allowed; sells require a user. Buy accepts exactly one of quantity or spend cents; sell accepts quantity only.
- `executeTrade(db, userId, input)` returns `{ result, replayed }`. It owns idempotency locking, market/user/holdings locking, execution, cash and vector updates, immutable trade insertion, and one matching mark.
- `settleLmsrBook(transaction, book)` (`services/dealer/settle-lmsr-book.ts`, called by the settle job) is irreversible and credits holders exactly once in stable user-ID order. The ladder's admin `settleMarket` is deleted (milestone 6).
- `getPortfolio(db, userId, options?)` returns cash, binary holdings marked at the book's price, open forward positions marked at the model mid (collateral, max gain/loss, unrealised), account value, and paginated trades.
- `verifyReplay(db)` is read-only and reports vector drift, PMF normalization, negative holdings, cash/MM-flow reconciliation, sequence gaps, and trade/mark disagreement.

## Transaction invariants

1. Advisory-lock the idempotency UUID, then check replay.
2. Lock open market, allocate `last_market_sequence + 1`, and capture `clock_timestamp()`.
3. Lock user, then upsert and lock holdings.
4. Validate and compute against locked state.
5. Apply slippage, cash, and holdings guards before any persistent mutation.
6. Update market, user, and holdings; insert trade and exactly one matching mark in the same transaction.
7. Store the complete successful response in `trades.execution_result`.
8. Replayed requests perform no mutations and return the stored response with `replayed: true`.

## Completion gate

- Part 1 tests remain green.
- Strict TypeScript passes.
- Unit tests cover quote, user, the binary portfolio mark, and replay analysis.
- PostgreSQL integration tests cover serialization, idempotency, rollback, sequence/mark pairing, settlement, and replay when a disposable database URL is available.
