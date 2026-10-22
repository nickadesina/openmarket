# Part 5 — Deployment Proof

Part 5 deploys the completed product to Vercel with Neon PostgreSQL. It must not fabricate successful deployment, database migration, seed verification, browser proof, or diagnostics.

## Environment contracts

Runtime pooled connection:

- `DATABASE_URL`

Direct unpooled operations:

- `DATABASE_URL_UNPOOLED`
- `DATABASE_URL_TEST` only in CI

Application/security:

- `APP_ORIGIN`
- Sign-in and admin are the tournament's: `X_CLIENT_ID`, `X_CLIENT_SECRET`, `TOURNAMENT_ADMIN_X_IDS` (`.env.example`, README §4)

Vercel-provided preview origins remain dynamically validated through Part 2 origin helpers.

## Deployment order

1. Confirm Vercel and Neon authentication without printing credentials.
2. Link the repository to one Vercel project.
3. Configure isolated Neon development/preview/production branches or document the exact external prerequisite if unavailable.
4. Set environment variables by scope without exposing values.
5. Run `npm ci`, typecheck, unit/property/service/route tests, PostgreSQL integration tests, and `next build`.
6. Run `npm run db:migrate` against `DATABASE_URL_UNPOOLED` before production traffic.
7. List the names with `npm run seed:listings -- --listed-at=<ISO>`; it refuses an anchor without a source URL.
8. Run `npm run verify:replay` against the direct production connection.
9. Deploy, then browser-drive the critical product flow on the deployed origin.

## Operations

- Route pools stay capped at two.
- Migrations are append-only after launch, except the owner-approved `008` (README D6).
- `seed:listings` is idempotent on (company, listed_at).
- Logs exclude secrets and cookies.
- CI uses PostgreSQL 17 and runs Parts 2–4 coverage.
- Deployment failure or missing credentials is reported as a concrete blocker after all reachable code/configuration work is complete.

## Completion gate

Production is complete only when the deployed application is reachable, the listed names are written, the browser flow succeeds, and replay/cash/sequence/mark diagnostics report clean state. A local build or Vercel configuration file is not a production deployment.
