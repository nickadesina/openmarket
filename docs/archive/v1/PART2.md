# Part 2 — Persistence and Transactions

Part 2 consumes the verified mathematical core in `PART1.md`. It adds PostgreSQL persistence and pure service APIs, but intentionally excludes Next.js route handlers and UI.

## Required prior context

- Read `TECHNICAL_DESIGN.md` §3 and §6 before editing.
- Reuse the engine exports in `src/lib/engine`; do not duplicate LMSR, grid, quantile or seeding math.
- Float vectors are application-zero-indexed and PostgreSQL arrays are PostgreSQL-one-indexed. Kysely must pass whole arrays rather than manually shifting their contents.
- Cash is integer cents. JSON-facing dollar values remain decimal strings at later route boundaries.

## Database contract

- `src/lib/db/schema.ts` exports `Database` and the row/table types for every table: the ledger (`companies`, `markets`, `users`, `holdings`, `trades`, `marks`, `settlements`), comments and `rate_limits`, the dealer (`listings`, `instruments`, `event_flags`, `cron_runs`, `model_mids`, `quotes`, `forward_positions`, `reference_prices`, `source_health`, `dealer_pnl`, `api_keys`, `event_flag_reviews`) and the `tournament_*` tables.
- `src/lib/db/client.ts` exports `createPooledDatabase(connectionString?)`, `createDirectDatabase(connectionString?)`, and `destroyDatabase(db)`.
- Route/service pools use `max: 2`; migration and diagnostics use `DATABASE_URL_UNPOOLED`.
- Every lock, advisory lock, and state mutation remains inside one Kysely transaction callback.

## Service contracts

- `ensurePaperAccount(db, tournamentUserId)` opens, race-safely, or returns the tournament user's paper account with a $100,000 initial balance (README D1).
- `quoteMarket(db, input, userId?)` is read-only. Anonymous buys are allowed; sells require a user. Buy accepts exactly one of quantity or spend cents; sell accepts quantity only.
- `executeTrade(db, userId, input)` returns `{ result, replayed }`. It owns idempotency locking, market/user/holdings locking, execution, cash and vector updates, immutable trade insertion, and one matching mark.
- `settleLmsrBook(transaction, book)` (`services/dealer/settle-lmsr-book.ts`, called by the settle job) is irreversible and credits holders exactly once in stable user-ID order. The ladder's admin `settleMarket` is deleted (milestone 6).
- `getPortfolio(db, userId, options?)` returns cash, binary holdings marked at the book's price, open forward positions marked at the model mid (collateral, max gain/loss, unrealised), account value, and paginated trades.
- `verifyReplay(db)` is read-only and reports vector drift, PMF normalization, negative holdings, cash/MM-flow reconciliation, sequence gaps, and trade/mark disagreement. `scripts/verify-replay.ts` also runs `verifyDealer` (mids, quotes, forward books, reference rows) and `verifyTournament` (scores, aggregates, provenance roots).

## Transaction invariants

1. Advisory-lock the idempotency UUID, then check replay.
2. Lock the book (a dealer binary: its instrument, then its open market; `trade-book.ts`), allocate `last_market_sequence + 1`, and capture `clock_timestamp()`.
3. Lock user, then upsert and lock holdings.
4. Validate and compute against locked state.
5. Apply slippage, cash, and holdings guards before any persistent mutation.
6. Update market, user, and holdings; insert trade and exactly one matching mark in the same transaction.
7. Store the complete successful response in `trades.execution_result`.
8. Replayed requests perform no mutations and return the stored response with `replayed: true`.

## Completion gate

- Strict TypeScript passes.
- Unit tests cover quote, user, the binary portfolio mark, and replay analysis.
- PostgreSQL integration tests cover serialization, idempotency, rollback, sequence/mark pairing, settlement, and replay when a disposable database URL is available.
