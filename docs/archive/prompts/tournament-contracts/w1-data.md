# Brief W1: migration 013

Repository `nickadesina/openmarket`. Branch `tc/w1-data` from
`tournament-contracts`; PR back into `tournament-contracts`. Read
`AGENTS.md` and `docs/decisions/0004-tournament-questions-follow-the-contracts.md`
(especially "Pinned interface → Database" and "Event hash") first.

## Yours (only these files)

- `src/lib/db/migrations/013_tournament_contract_models.ts` (new)
- `tests/integration/postgres.ts` (truncate list: remove
  `tournament_buckets`, add `tournament_archived_forecast_vectors`)
- `tests/integration/identity.test.ts` (append `013_…` to the
  migration-name list only)
- `tests/integration/tournament-migration.test.ts` (new)

**Not yours:** `schema.ts` (W0 wrote it; if it disagrees with your
migration, the migration follows 0004 and you flag the mismatch in the
PR), every service, component and dealer file.

## Do

Write 013 exactly as 0004 specifies, in one `up`:

- Pre-checks that `raise exception` if any `tournament_resolutions` or
  `tournament_scores` row exists, or any `reference_prices` row's
  `components_json` has a crowd object citing an aggregate.
- Questions: add `kind`, backfill (`bool`/`choice` → binary with null
  unit; `USD_B`/`USD_T` → forward), set not null; unit nullable with
  `check ((kind = 'forward') = (unit is not null))` and
  `unit in ('USD_B','USD_T')`; drop `bucket_count` and the
  `_binary_shape`, `_bucket_count`, `_unit` checks. Then void every
  question not already voided or resolved: `status = 'voided'`,
  `slug = slug || '-v1'`, `void_note_md` = "Replaced by the
  binary/forward question at /t/q/<original slug>; bucket forecasts are
  not scored." (the original slug, before the rename).
- Events: create `tournament_archived_forecast_vectors` with the same
  append-only trigger function the events table uses (see
  `004_tournament.ts:295-319`); `insert … select id, probs`; add `p`,
  `value` with their range checks and
  `check (num_nonnulls(p, value) = 1) not valid`; drop `probs` and
  `_probs_nonnegative`. Never `update` or `delete` an event row (the
  trigger refuses, and posted Merkle roots depend on them).
- Aggregates: `delete from tournament_aggregates`; drop the vector and
  derived columns and `_probs_present`; add `p`, `value` and the
  exactly-one-when-published check.
- `drop table tournament_buckets`.
- Resolutions: drop `winning_bucket_index`; add `outcome` with its
  check and `num_nonnulls(outcome, resolved_value) = 1`.

`down`: `raise exception` if any `tournament_questions` row exists;
otherwise restore the 012 shape on an empty schema (recreate
`tournament_buckets` with its constraints and floor index, the dropped
columns and checks, drop the new ones). Precedent: 008 and 011.

Header comment like `008`: what changes, that it is an owner-approved
data change, that bucket forecasts are archived not deleted and why.
Migrations import only `kysely`.

## Tests (`tournament-migration.test.ts`)

Migrate a test database to `012_tournament_choice`; insert three open
questions (USD_T ladder, USD_B ladder, choice) with buckets, a few
vector events, a provenance batch with leaves over them; migrate to
latest. Assert: questions voided and renamed with the note; vectors in
the archive table byte-equal to the inserts; each event's stored
`event_hash` equals sha256(question_id ‖ user_id ‖ ISO time ‖
canonical archived probs); batch roots still recompute from the leaves;
a new event with neither or both of `p`/`value` is refused; `down`
refuses with questions present; on an empty database latest → 012 →
latest succeeds. Use the helpers in `tests/integration/postgres.ts`
(`migrateTestDatabase`).

## Done

Your test and `identity.test.ts`, `dealer-schema.test.ts` pass. Note in
the PR anything W0's `schema.ts` got wrong.
