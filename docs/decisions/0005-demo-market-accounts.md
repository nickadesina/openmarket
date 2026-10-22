# 0005 — Five demo accounts trade the listed names

Date: 2026-10-22. Status: decided (Nick, 2026-10-22).
Amends `AGENTS.md` → "Real data only": this is its one exception.
Built on `ob/o3-demo-markets` (migration `015_demo_accounts`,
`npm run seed:demo`).

## Why

Nick: "Seed the five markets with paper information to the level of like
five seeded accounts; those five are just to show how the product should
work. The contracts as they exist are for show now; the real party is in
the tournament."

The five listed names each carry a quarterly binary and a next-print
forward, quoted by the dealer, and nobody trades them. Every market page
reads "No trades yet", the chart is a flat model line and open interest
is $0. A visitor cannot see what the venue does.

## Decision

Five demo accounts trade the listed names, so the pages show what live
markets look like.

- **For show only.** Demo accounts exist to show the markets working.
  They are paper accounts like any other ($100,000 each, README D1) and
  carry no other meaning.
- **Labelled everywhere they appear.** `tournament_users.demo` marks
  them; the activity services carry the flag to the UI, and every row
  from a demo account shows a "Demo" tag. Market pages and the board say
  these are paper demo markets and link to the tournament, where
  forecasts count.
- **Real services only.** They trade through `executeTrade` and
  `executeForwardTrade`, inside the dealer's limits (cap, price band),
  so every ledger invariant and `verify:replay` holds unchanged. Nothing
  is written to the ledger by hand.
- **Backdated, honestly (amended, Nick, 2026-10-22).** The trades are
  spread over the last 21 days through the services' own `now`. On each
  book they start after the name's listing, its instrument's opening and
  every quote, reference, trade and mark row already on it, and they end
  at the seed run. So each fill takes the quote the dealer showed at its
  time, and no earlier row ever reads one. The accounts' own rows carry
  the seed run's time.
- **Never forecast, never ranked, never signed in.** A demo account has
  a `password`-namespace identity (`demo_1` … `demo_5`, shown without an
  "@") and no credential, no X id and no session. Migration 015's
  triggers refuse a session, a credential or a non-`password` identity
  for a demo user, and registering a demo handle is refused as taken.
  With no forecasts they have no scores, so they never reach the
  leaderboard.
- **Nothing invented but the trades.** Handles say what they are
  (`demo_1`, "Demo trader 1"); no biography, avatar or affiliation.
  Demo accounts trade; they never comment or post.
- **Fixed seed.** The trades come from one seeded generator
  (`src/lib/config/demo-accounts.ts`), so a fresh database listed and
  quoted the same way gets the same book. They are not meant to move any
  price to a level.

### Why a column, not a `'demo'` provider

The flag belongs to the account, not to how it signs in. A column is one
fact the services can join (`tournament_users.demo`), and it leaves
`TournamentProvider` and every caller of it alone. A `'demo'` provider
would widen that union through the sign-in, admin-key and client
formatting code, and a bare `demo_1` slug would share the X namespace
with a real @demo_1. The `password` namespace is the site's own, so a
demo handle can never pass for an X handle.

## Deploy

`scripts/vercel-build.ts` runs `npm run seed:demo` after
`seed:tournament` and before `verify:replay`. The seed creates the five
accounts and their paper balances, and trades only when there are live
quotes. When the demo accounts already hold a trade it does nothing,
and when there are no listings or no live quotes (a fresh preview before
the dealer job has run) it logs why and exits cleanly.

## Consequences

- Demo fills are fills. They count toward open interest, the dealer's
  inventory and P&L, the forward's skew, the binary's price and the
  30-day traded component of the reference price (D14), like any fill.
  The seed keeps their size small. Taking them out of the reference
  blend would mean a new `BLEND_VERSION`; that is open (Nick).
- Removing them takes a migration that settles or refunds their
  positions through the services. Migration 015's `down` refuses while a
  demo user exists.

Not changed: two contracts per name, void-and-refund, the dealer always
quotes, version stamps on every published price, the tournament.
