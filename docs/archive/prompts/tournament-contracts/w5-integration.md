# Brief W5: integrate and prepare the release

Repository `nickadesina/openmarket`. Start once W1–W4 have merged into
`tournament-contracts`. Read `AGENTS.md` and
`docs/decisions/0004-tournament-questions-follow-the-contracts.md` in
full first, then every W1–W4 PR description (their "Needs from W*"
sections are your work list).

## Yours

- Whatever the W1–W4 PRs left between them: type mismatches, a test
  that needed two workstreams' changes, a "Needs from" item. Fix it on
  `tournament-contracts`. Don't redesign. If a fix would change the
  pinned interface, stop and ask Nick.
- `README.md` D9 and its bridge section, and the 0004 status line
  (`implemented`).
- `AGENTS.md` lines about the tournament (`engine/tournament holds the
  tournament's buckets, scoring, aggregate, and median`, and so on).

## Do

1. Run every gate on `tournament-contracts`:
   - `npm run check`
   - `npm run test:unit`
   - `npm run test:integration` against local Postgres
   - `npm run test:browser:local`
   - `npm run verify:replay` against a database migrated to 013 with
     seeded questions and forecasts of both kinds
2. Search for leftovers. These must return nothing outside migrations
   and the archive table:
   - `rg -n "bucket|probs|floor|choice|median_value|p_yes|winning_bucket" src scripts tests`
3. Rehearse the migration on a preview deploy. Open a PR from
   `tournament-contracts` to `master`; its preview build migrates the
   preview Neon branch. In the PR, record what 013 did there: rows
   voided, vectors archived, proof page for a legacy event still
   verifying.
4. In the PR to `master`, write the release steps from 0004 → Release
   as a checklist for Nick. Do not merge it. Do not touch production.

## Done

A PR `tournament-contracts → master` with every gate green, the
preview rehearsal recorded, and the release checklist.
