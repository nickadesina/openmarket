# Brief O2: make settlement and scoring intuitive

Repository `nickadesina/openmarket`. Branch `ob/o2-scoring` from
`master`; PR to `master`, merged by you once the gates pass. Read
`AGENTS.md`, `PRODUCT.md`, `DESIGN.md`,
`docs/decisions/0004-tournament-questions-follow-the-contracts.md`,
`CONTRACTS.md` → Tournament mapping and
`docs/prompts/onboarding-and-demo/README.md` first.

## The problem

Nick: "this settlement logic is not intuitive. Idk how the math is but it
is not intuitive to the user. I want it to be intuitive."

**The bar:** a forecaster who has never heard of a scoring rule can say,
before submitting:
- what settles the question;
- what their number will score in the likely outcomes;
- why forecasting early and honestly is their best move.

Today none of that is true. The forward editor ends in two blocks of
text:

- a row "SCORE IF IT SETTLES · Exact 100 · 10% off 86 · 2× off 0";
- a paragraph: "The score you keep is this one averaged over the open
  window. Time before your first forecast counts as 0, the score of a 2×
  miss, so an early level that stays close counts most."

Neither tells the forecaster what *their* number earns, when the question
settles, or what makes it void. The rules underneath (decision 0004) have
their own rough edges:

- A binary scores 100/ln 2 · ln(2p) on the outcome. That means 0 for
  "50%", 100 for certain and right, and a floor of −896.6 for certain and
  wrong.
- A forward scores max(100 · (1 − |ln(x/y)|/ln 2), −896.6): 100 when
  exact, 0 at a 2× miss, negative beyond.
- Both are averaged over the open window, and time before a first
  forecast counts as 0.

## Two stages

**Stage 1, always: explain the rules as they are** (section "Do" below).
Often that is enough.

**Stage 2, only if stage 1 cannot meet the bar: change the rule.** Nick
has authorised this. The judgement is yours; record it as
`docs/decisions/0006-intuitive-tournament-scoring.md`, written like 0004
(Why, Decision, Calls), with worked examples a non-expert can follow.
Constraints:

- **Proper.** Reporting your true belief maximises your expected score.
  For a forward, that means your median.
  - An affine rescale of a proper rule stays proper, so you can change the
    scale freely.
  - Any other change needs the properness argument written in 0006.
  - If you give up strict properness (e.g. by truncating at 0), say
    exactly where and why it's acceptable.
- **One scale for both kinds.** The leaderboard sums one column, so a
  binary and a forward must be comparable on it.
- **Explainable in two sentences,** with a worked example on the page.
  Prefer no negative scores if you can keep the rule proper.
- **Time-averaging,** or whatever replaces it, still rewards forecasting
  early and staying right, and can be stated in one sentence with the
  forecaster's own numbers.
- **Safe to change now.** Check that `tournament_scores` and
  `tournament_resolutions` are empty in production at merge time.
  - A test database proves nothing here. The Vercel build log or Nick can
    confirm it. If you can't confirm it, ask in the PR before merging.
  - If any score exists, stop and ask Nick: rescoring resolved questions
    is his call.
- **Leave the rest alone:** forecasts, event hashes, the crowd aggregate
  and the dealer blend. A scoring change must not touch them.

## Yours (only these)

- `src/components/tournament-question/**`: the forecast editor, the
  question workspace, and the crowd and resolution modules
- `src/components/tournament-board/**` and
  `src/components/tournament-leaderboard/**`
- The tournament parts of `src/lib/client/format.ts`, and
  `src/lib/client/tournament.ts`
- Stage 2 only:
  - `src/lib/engine/tournament/score.ts`;
  - `src/lib/services/tournament/scoring.ts`;
  - the `rules` block in `src/lib/services/tournament/get-question.ts`;
  - `tests/engine/tournament.test.ts` and the scoring cases in
    `tests/integration/tournament.test.ts`;
  - `CONTRACTS.md` → Tournament mapping, README D9's scoring lines, and a
    pointer from 0004 to 0006.
- `tests/browser/tournament.spec.ts`, and unit tests for anything you add

**Not yours:**
- Sign-in, welcome, nav and the app shell. These are O1's.
- Markets and the dealer, including `blend.ts`. These are O3's or nobody's.
- `aggregate.ts` and `forecast.ts`.
- Migrations. Score columns keep their names; if a rule change needs a
  column, stop and ask.

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
2. **The score, live, for the number typed.** Replace the static rows.
   - Forward, a sentence like: "You enter $1.30T. If it settles at $1.30T
     you score 100; at $1.43T or $1.18T, 86; at $2.60T or $0.65T, 0."
   - Binary: the If YES / If NO figures, plus one line on what 50% and
     certainty score.
   - Compute every figure with the engine's functions, never by hand.
   - Show the forward row only once a valid level is entered.
   - When a crowd figure or dealer mid exists, also show what you'd score
     if it settled there. Only when the figure exists (Real Density).
3. **Time, said once and concretely.** Replace the paragraph with one
   sentence plus the forecaster's own coverage when they have one, e.g.
   "Your score is averaged over the whole open window; you've held a
   forecast for 3 of 41 days so far." Coverage comes from data the page
   already has (the viewer's first forecast time and the window). If it
   isn't there, list it in "Needs from" instead of guessing.
4. **Resolution module.** After settlement, show the forecaster's own
   score beside the outcome when they forecast. Use existing API fields
   (stage 2 may add to `rules` or the score view); don't compute scores
   client-side.
5. **Board and leaderboard.**
   - A one-line cue per question: "Binary · settles by {date}" or
     "{levelLabel} · settles at the print".
   - A one-line "how scores add up" on the leaderboard.
6. **Rules that bind:**
   - Red Interface / Green Movement: a positive score is not green; give
     it a sign and a word.
   - Price Precision and Caps Voice.
   - Tabular numerals for the score figures.

## Tests

- Unit tests for every formatter and, in stage 2, for the new rule:
  - the anchor values;
  - properness, checked numerically: a grid of beliefs shows the truthful
    report maximises expected score;
  - time-averaging.
- Integration: resolve and score both kinds under the rule in force.
- `tournament.spec.ts`:
  - forward: type a level, see the live score row with the right figures;
  - binary: see the If YES / If NO rows and the line.

## Done

PR merged to `master` with gates green, and before/after screenshots of
both editors and the settles block at desktop and 375px. In the PR, say
which stage you shipped. If you shipped stage 2, give the two-sentence
explanation of the new rule exactly as the page shows it.
