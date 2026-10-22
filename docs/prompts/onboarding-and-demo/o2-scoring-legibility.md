# Brief O2: make settlement and scoring legible

Repository `nickadesina/openmarket`. Branch `ob/o2-scoring` from
`master`; PR to `master`, merged by you once the gates pass. Read
`AGENTS.md`, `PRODUCT.md`, `DESIGN.md`,
`docs/decisions/0004-tournament-questions-follow-the-contracts.md` and
`docs/prompts/onboarding-and-demo/README.md` first.

## The problem

Nick: "this settlement logic is not intuitive." The forward editor ends in
two blocks of text:

- a row "SCORE IF IT SETTLES · Exact 100 · 10% off 86 · 2× off 0";
- a paragraph: "The score you keep is this one averaged over the open
  window. Time before your first forecast counts as 0, the score of a 2×
  miss, so an early level that stays close counts most."

A forecaster can't tell from these what *their* number earns, when the
question settles, or what makes it void.

The binary editor is better, with its "If YES +48.5 / If NO −73.7" rows.
It still leaves "averaged over the open window" unexplained.

**The math does not change.** Decision 0004 fixed the binary log score,
the forward score, time-averaging and the void rules. This brief changes
how they are shown. If you conclude the math itself is the problem, write
that up in the PR for Nick; do not change `score.ts`.

## Yours (only these)

- `src/components/tournament-question/**`: the forecast editor, the
  question workspace, and the crowd and resolution modules
- `src/components/tournament-board/**`
- The tournament parts of `src/lib/client/format.ts`
- `src/lib/client/tournament.ts`, if you need a client helper
- `tests/browser/tournament.spec.ts`, and unit tests for any formatter or
  helper you add

**Not yours:**
- Sign-in, welcome, nav and the app shell. These are O1's.
- Markets and the dealer. These are O3's.
- `src/lib/engine/**` and the tournament services. Import the engine's
  pure functions (`pointLogScore`, `forwardScore`); don't edit them.
- Migrations.

## Do

1. **"How this settles": one short block at the top of every question.**
   Use only data the question already carries: kind, unit, `levelLabel`,
   `closesAt`, `expiryAt`, and the rulebook.
   - Binary: "Settles YES if … by {date}. Anything else, including nothing
     by {date}, is NO."
   - Forward: "Settles at the {levelLabel} when it prints. If nothing
     prints by {date}, the question voids and nobody is scored."
   - The condition comes from the question's own title and rulebook. If
     you can't state it from existing fields without inventing words, link
     "Full rules" to the rulebook section rather than paraphrasing.
2. **The forward score, live, for the number typed.** Replace the static
   "Exact 100 · 10% off 86 · 2× off 0" with a row that reads the field.
   - A sentence like: "You enter $1.30T. If it settles at $1.30T you score
     100; at $1.43T or $1.18T, 86; at $2.60T or $0.65T, 0."
   - Compute every figure with the engine's `forwardScore`, never by hand.
   - Show the row only once a valid level is entered.
   - When a crowd median or dealer mid exists, also show what you would
     score if it settled there. Only when the figure exists (Real Density).
3. **The binary score.** Keep the If YES / If NO preview, and add one
   plain line: "50% scores 0 either way; being confident and right scores
   up to +100."
4. **Time-averaging, said once and concretely.** Replace the paragraph
   with one sentence plus the forecaster's own coverage when they have
   one, e.g. "Your score is averaged over the whole open window; you've
   held a forecast for 3 of 41 days so far, and days before your first
   forecast count as 0." The 0 means 50% for a binary and a 2× miss for a
   forward.
   - Coverage comes from data the page already has: the viewer's first
     forecast time and the window. If it isn't available, say so in
     "Needs from" instead of guessing.
5. **Resolution module.** After settlement, show the forecaster's own
   score beside the outcome when they forecast. Use existing API fields;
   if one is missing, put it in "Needs from" rather than computing scores
   client-side.
6. **Board.** A one-line cue per question: "Binary · settles by {date}" or
   "{levelLabel} · settles at the print".
7. **Rules that bind:**
   - Red Interface / Green Movement: a positive score is not green; give
     it a sign and a word.
   - Price Precision and Caps Voice.
   - Tabular numerals for the score figures.

## Tests

- Unit tests for any new formatter, checked against the engine's numbers.
- `tournament.spec.ts`:
  - forward: type a level, see the live score row with the right figures;
  - binary: see the new line.

## Done

PR merged to `master` with gates green, and before/after screenshots of
both editors and the settles block at desktop and 375px.
