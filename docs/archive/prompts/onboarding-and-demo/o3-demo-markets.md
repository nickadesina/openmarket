# Brief O3: demo markets with five seeded accounts

Repository `nickadesina/openmarket`. Branch `ob/o3-demo-markets` from
`master`; PR to `master`, merged by you once the gates pass. Read
`AGENTS.md`, `README.md` §2 (D10–D14), `CONTRACTS.md`, `PRODUCT.md`,
`DESIGN.md` and `docs/prompts/onboarding-and-demo/README.md` first.

## The goal

Nick: "Seed the five markets with paper information to the level of like
five seeded accounts; those five are just to show how the product should
work. The contracts as they exist are for show now; the real party is in
the tournament."

The five listed names each carry a quarterly binary and a next-print
forward, quoted by the dealer. Nobody trades them, so the market pages are
empty. Five clearly labelled demo accounts will trade them through the
real services, so the pages show what live markets look like.

This is a deliberate exception to `AGENTS.md`'s "Real data only" rule.
Record it as decision 0005 before writing code.

## Yours (only these)

- `docs/decisions/0005-demo-market-accounts.md` (new)
- The `AGENTS.md` "Real data only" line, which gains the 0005 exception
- `src/lib/db/migrations/015_demo_accounts.ts`: the only migration in
  this batch
- `src/lib/db/schema.ts`: only the column you add
- `src/lib/config/demo-accounts.ts` (new) and `scripts/seed-demo.ts` (new)
- The `seed:demo` script in `package.json`
- `scripts/vercel-build.ts`: one added step
- `src/components/market-*/**`, `home-*/**`, `src/components/portfolio/**`,
  `src/app/m/[slug]/**` and `src/app/portfolio/**`: the demo labelling
- `src/lib/services/get-activity.ts` and the market read services, only to
  carry the demo flag to the UI
- Tests for all of the above

**Not yours:**
- Sign-in, welcome, nav, `src/app/page.tsx` and the new `/m` index. These
  are O1's. O1 moves the markets board to `/m`; list any link you need
  changed under "Needs from O1".
- The tournament UI and scoring. These are O2's.
- `src/lib/engine/**`, `src/lib/config/dealer.ts` and
  `backtest/out/params.json`. Never write a dealer parameter.
- `execute-trade.ts` and `execute-forward-trade.ts`: call them, don't
  change them.

## Do

1. **Decision 0005** (short, same shape as 0004). It covers:
   - Demo accounts exist only to show the markets working.
   - They are labelled everywhere they appear.
   - They trade only through the real services, so the ledger invariants
     and `verify:replay` hold.
   - They never forecast, never appear on the tournament leaderboard, and
     cannot sign in.
   - Copy and comments are not invented: demo accounts trade, they don't
     post.
   - Status `decided (Nick, 2026-10-22)`.
2. **Migration 015.**
   - Add `demo boolean not null default false` to `tournament_users`, or
     add a `'demo'` identity provider; choose one and say why.
   - Demo identities have no password credential and no X id, so nothing
     can sign in as them.
   - Its `down` refuses while a demo user exists.
3. **`src/lib/config/demo-accounts.ts`.** Five accounts, with handles that
   say what they are (`demo_1` … `demo_5`, display name "Demo trader 1"
   …). No invented biographies, avatars or affiliations.
4. **`scripts/seed-demo.ts` (`npm run seed:demo`).**
   - **Idempotent:** creates the five demo identities and their paper
     accounts (`ensurePaperAccount`, $100,000 each). If the demo accounts
     already hold any trade, it does nothing.
   - **Trades through the real services:** for each listed name with live
     instruments, a handful of trades per account across the binary
     (`executeTrade`) and the forward (`executeForwardTrade`), on both
     sides.
     - Sizes stay inside the dealer's limits.
     - The trades come from a **fixed seed**, so reruns on a fresh
       database produce the same book.
     - The intent is that the books, activity feed and price charts look
       like a market people use. It is not meant to move prices to any
       particular level.
   - **Skips, logging why,** when there are no listings or no live quotes,
     e.g. on a fresh preview before the dealer job has run. It never fails
     the build for that.
   - **Leaves the tournament alone:** never forecasts and never touches
     tournament questions.
5. **Deploy.** Run `seed:demo` in `scripts/vercel-build.ts` after
   `seed:tournament` and before `verify:replay`, so a merge seeds
   production with no manual step. `verify:replay` must pass after it.
6. **Label the markets as a demo.**
   - Market pages and the markets board carry a short, plain banner: these
     are paper demo markets, with the activity from demo accounts, and the
     tournament is where forecasts count. It links to `/t`.
   - Every row from a demo account (activity, trades, holders) shows a
     "Demo" tag.
   - The portfolio and trade ticket still work for a real signed-in user
     who wants to try them.
7. **Leaderboard and profiles.** Confirm that demo users never appear on
   `/t/leaderboard`. They can't, because they have no scores, but add a
   test. If `/t/u/demo_1` renders, it shows the Demo tag.

## Tests

- **Integration:**
  - `seed:demo` on a fresh listed-and-quoted database creates five demo
    accounts with trades, and a second run changes nothing;
  - `verify:replay` passes afterwards;
  - no demo account has a credential or a forecast;
  - the leaderboard excludes them;
  - migration 015 up and down.
- **Browser:** a market page shows the demo banner and a Demo-tagged
  activity row.

## Done

PR merged to `master` with gates green. Then, after the production deploy,
check that the five market pages show demo activity. Before/after
screenshots go in the PR.
