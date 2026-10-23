# Part 5 — Deployment Proof

Deployment is Vercel with Neon PostgreSQL. Never fabricate successful deployment, database migration, seed verification, browser proof, or diagnostics.

## Environment contract

`.env.example` is the contract: every variable the app, the scripts and
the build read, with its scope. `scripts/verify-production-config.ts`
validates the database, origin and Neon branch variables for the target
at build time (`npm run deploy:check` runs it by hand).

## Deployment order

A merge to `master` deploys to production. `scripts/vercel-build.ts`
runs, in order and stopping at the first failure:

1. validate the environment for the target (production or preview);
2. `npm run db:migrate` against `DATABASE_URL_UNPOOLED`;
3. `npm run seed:tournament -- --open` (opens only missing launch questions);
4. `npm run verify:replay`;
5. `next build`.

Steps 2–3 change the database before the build compiles, so a failed
build leaves the new schema under the previous deployment; migrations
must stay compatible with the code they replace.

Operator steps, never run by the build: list the names with
`npm run seed:listings -- --listed-at=<ISO>` (it refuses an anchor
without a source URL), create API keys with `npm run api-key:create`.

## Operations

- Route pools stay capped at two.
- Migrations are append-only after launch, except the owner-approved `008` (README D6).
- `seed:listings` is idempotent on (company, listed_at).
- Logs exclude secrets and cookies.
- CI uses PostgreSQL 17 and runs Parts 2–4 coverage.
- Deployment failure or missing credentials is reported as a concrete blocker after all reachable code/configuration work is complete.

## Completion gate

Production is complete only when the deployed application is reachable, the listed names are written, the browser flow succeeds, and replay/cash/sequence/mark diagnostics report clean state. A local build or Vercel configuration file is not a production deployment.
