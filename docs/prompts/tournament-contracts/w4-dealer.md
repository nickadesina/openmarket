# Brief W4: the dealer side and the contract docs

Repository `nickadesina/openmarket`. Branch `tc/w4-dealer` from
`tournament-contracts`; PR back into it. Read `AGENTS.md`,
`CONTRACTS.md`, `README.md` §2 (D10–D14), `TECHNICAL_DESIGN.md` §7–§8
and `docs/decisions/0004-tournament-questions-follow-the-contracts.md`
in full first.

## Yours (only these)

- `src/lib/services/dealer/tournament-bridge.ts`
- `src/lib/engine/dealer/question-ladder.ts` and
  `tests/engine/dealer/question-ladder.test.ts` (delete both)
- `src/lib/services/dealer/reference-prices.ts`,
  `src/lib/services/dealer/list-instruments.ts`
- `src/lib/engine/dealer/blend.ts` (version bump only)
- `tests/integration/{tournament-bridge,crowd-gate,dealer-reference,evidence}.test.ts`,
  `tests/services/tournament-bridge.test.ts`
- `CONTRACTS.md` → Tournament mapping; `TECHNICAL_DESIGN.md` §7

**Not yours:** tournament services, engine, UI, migrations, `schema.ts`.

## Do

Bridge:
- Keep create/open/link in the listing transaction, the slugs, the
  rulebook text builders (drop "bucket holding"), `instrumentEnding`,
  resolve-or-void on settlement, the back-dated close, and the
  `TOURNAMENT_LINKED_QUESTIONS` flag.
- A binary instrument links a `kind: "binary"` question. A forward
  links a `kind: "forward"` question in the instrument's unit
  (`USD_T` from a $1T mid, else `USD_B`) with `expiry_at` = T and no
  edges.
- Resolution: binary YES/NO becomes `outcome`; a settled forward
  becomes `resolved_value` = post-money in the unit; a forward void
  stays a void.
- Delete `expectedWinningBucket` and `ladderDescription`, the σ lookup,
  and `linkInstrumentQuestion`'s `midLn` parameter (with
  `latestMid` in the backfill in `list-instruments.ts`).
- `verifyLinkedQuestions` compares the outcome or value.

Reference prices:
- `crowdValue` reads the aggregate's `p` for a binary, and
  `ln(value · UNIT_USD[unit])` for a forward.
- Drop the `bool`/`choice` unit checks; use the question's `kind`.
- The crowd component JSON gains `kind`; `unit` is null for binaries.
- Stored reference rows are append-only and keep their old JSON; don't
  rewrite them.

`blend.ts`: bump `BLEND_VERSION`, because the crowd's definition
changes from a bucket-derived median to a median of levels. Add the
schedule entry the file's convention requires, and never edit the
published one. If `origin/decision/0003`'s crowd-weight ramp has
landed, share its bump.

Docs:
- `CONTRACTS.md` Tournament mapping:
  - A = one probability, the time-averaged n = 2 log score.
  - B = one level, the forward score in 0004, unscored if the forward
    voids.
- `TECHNICAL_DESIGN.md` §7: rewrite to match; the ladder goes.

## Tests

Rewrite the bridge, crowd-gate and dealer-reference tests from bucket
vectors to p and level forecasts:
- the ten-forecaster crowd gate still holds;
- a settled forward resolves its question to the post-money;
- a void voids it;
- the reference row's crowd component is the median ln level.

Evidence tests need only the new question shape.

## Done

Your tests pass against W1's 013 and W2's services (rebase on
`tournament-contracts` once they merge). `npm run audit:deps` clean.
