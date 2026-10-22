# Brief W3: tournament screens

Repository `nickadesina/openmarket`. Branch `tc/w3-ui` from
`tournament-contracts`; PR back into it. Read `AGENTS.md`,
`DESIGN.md`, `PRODUCT.md` and
`docs/decisions/0004-tournament-questions-follow-the-contracts.md` in
full first. Code against the types W0 committed (`QuestionCore` in
0004); you never import services except as types, and get data through
`/api/t`.

The point of this workstream is that forecasting gets **easy**: one
number per question, with the crowd and the market beside it and the
score consequence visible before submit.

## Yours (only these)

- `src/components/tournament-*/**` (board, question, editor, forecaster,
  admin, nav, provenance page, leaderboard)
- `src/app/t/**`
- the tournament parts of `src/lib/client/format.ts` and
  `src/lib/client/query-keys.ts`
- `src/styles/shared.module.css` (lift primitives)
- `tests/browser/tournament.spec.ts`

**Not yours:** `src/components/trade-ticket/**` (compose its lifted
primitives, don't edit the ticket beyond switching it to the shared
classes if the lift requires it — say so in the PR), services, engine,
dealer.

## Do

Delete:
- `tournament-distribution/`, the weights editor table, "Copy the
  crowd" / "Uniform", the bucket table, floor styling, the median line,
  "P(floor)", `formatTournamentMedian`, `formatLeadingOutcome`,
  `choice` in `TournamentUnitLabel`, and the dead CSS (`.editorTable`,
  `.floorRow`, `.weightCell`, `.weightInput`).

Lift into `shared.module.css`:
- `.inputFrame`, `.twoWay` and `.quickAmounts` from
  `trade-ticket.module.css`, so the ticket and the editor both compose
  them.

Binary editor (heading "Chance of YES"):
- One `%` field: `inputMode="decimal"`, step 0.1, range 0.1–99.9.
- One 1–99 range slider under it, hidden under 42rem as today.
- A three-cell YOU · CROWD · MARKET readout.
- Chips "Crowd 42.0%" and "Market 38.5%", each rendered only when its
  figure exists.
- Preview rows "If YES +48.5" / "If NO −73.7" from `pointLogScore`.
- One muted line on time-averaging.

Forward editor (heading = the question's level, e.g. "First-day market cap"):
- One field with a `$` prefix and a `B`/`T` suffix from `unit`.
- A readout of CROWD MEDIAN · DEALER MID · LAST ROUND, only the cells
  that exist.
- Matching chips.
- A preview line "Exact 100 · 10% off 86 · 2× off 0".
- The void condition in plain words beside the field.

Crowd module:
- One figure in the spec table: "42.0% YES" or "$412B median".
- Rows FORECASTERS, UPDATED, MARKET.
- A step line from `GET /api/t/questions/[slug]/aggregate/history`,
  published rows only, with its text summary.

Resolution module:
- OUTCOME (YES/NO) or SETTLED VALUE, plus SOURCE RANK.
- "Crowd at close" as a row.

Forecast list: a ruled table with columns FORECASTER · FORECAST ·
UPDATED · REVISIONS · PROOF.

Board, profile and admin:
- Board crowd column: "42.0% yes" or "$412B". The caption becomes
  "Binary · by {expiry}" or "Forward · {unit}".
- Profile positions: YOU · CROWD · REVISIONS.
- Admin resolve: a YES/NO select, or a value field plus source rank.
  Update the draft JSON placeholder.

Copy: rewrite every bucket-era string, per kind. As of `master` at
0004:
- `src/app/t/page.tsx`: the intro ("Submit a probability for every
  bucket … time-averaged log probability you held on the outcome").
- `tournament-nav.tsx`: the tagline "Log-scored distributions. No
  money, no trading."
- `question-workspace.tsx`:
  - "The crowd distribution is published once …"
  - "Crowd distribution:" (summary and tab)
  - "Winning bucket"
  - "{label} won with …"
  - the rulebook scoring paragraph ("relative to uniform … geometric
    mean of odds … each vector clamped")
- `forecast-editor.tsx`:
  - "Every vector you submit"
  - "A bucket at 0% counts as … Put weight on at least one bucket."
  - the component's doc comment
- `tournament-board.tsx`: "All mass on the floor" and "on the floor".
- `forecaster-page.tsx`: "All on the floor" (twice).
- `tournament-admin.tsx`: "blank = floor …" and "Winning bucket:".
- `provenance-page.tsx`: "‖ probs" and the `probsCanonical` wording
  (match W2's payload names).
- `format.ts`: "A ladder value", "One of the outcomes", "0 is uniform".

`rg -n "bucket|floor|distribution|vector|uniform" src/components src/app/t`
should find none of these when you're done.

DESIGN.md rules that bind:
- Real Density: no placeholder chips or cells.
- One Plate: "Your forecast" keeps `.actionTab`.
- Fixed Ramp.
- Red Interface, Green Movement: a positive preview is not green; use a
  sign and a word.
- Price Precision.
- Caps Voice.
- 2.25rem controls.

PRODUCT.md: consequences are inspectable before commitment, and the
page meets WCAG 2.2 AA.

## Tests

`tests/browser/tournament.spec.ts`: one forward case (fill the level,
submit, see it in the list) and one binary case. Keep the existing
admin-creates-then-opens pattern with the new draft JSON.

## Done

`npm run check` passes on your files (the style and layer audits
included). Screenshots of both editors at desktop and 375px in the PR.
