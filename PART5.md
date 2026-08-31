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
- `USER_COOKIE_SECRET`: canonical base64url, at least 32 decoded random bytes
- `ADMIN_COOKIE_SECRET`: distinct canonical base64url, at least 32 decoded random bytes
- `ADMIN_PASSPHRASE_HASH`

Vercel-provided preview origins remain dynamically validated through Part 2 origin helpers.

## Deployment order

1. Confirm Vercel and Neon authentication without printing credentials.
2. Link the repository to one Vercel project.
3. Configure isolated Neon development/preview/production branches or document the exact external prerequisite if unavailable.
4. Set environment variables by scope without exposing values.
5. Run `npm ci`, typecheck, unit/property/service/route tests, PostgreSQL integration tests, and `next build`.
6. Run `npm run db:migrate` against `DATABASE_URL_UNPOOLED` before production traffic.
7. Verify current public Stripe and Anthropic anchor valuation, date, description, and source. Never promote draft anchors.
8. Seed through the shared seed service.
9. Run `npm run verify:replay` against the direct production connection.
10. Deploy, then browser-drive the critical product flow on the deployed origin.

## Operations

- Route pools stay capped at two.
- Migrations are append-only after launch.
- Seed is idempotent and refuses traded-market replacement.
- Logs exclude secrets and cookies.
- CI uses PostgreSQL 17 and runs Parts 2–4 coverage.
- Deployment failure or missing credentials is reported as a concrete blocker after all reachable code/configuration work is complete.

## Completion gate

Production is complete only when the deployed application is reachable, both verified markets are seeded, the browser flow succeeds, and replay/cash/sequence/mark diagnostics report clean state. A local build or Vercel configuration file is not a production deployment.
