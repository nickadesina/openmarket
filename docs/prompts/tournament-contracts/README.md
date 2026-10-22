# Dispatch: tournament questions follow the two contracts

Six briefs for six agents implementing
`docs/decisions/0004-tournament-questions-follow-the-contracts.md`.
Each brief stands alone; each agent reads 0004 in full first.

## Before dispatch

Nick answers the four "Open calls" in 0004 and flips its status to
`decided`. A brief never re-opens a call: agents implement the answer
written in 0004.

## Order and branches

```
master
 └─ tournament-contracts            ← W0 commits the compile target here
     ├─ tc/w1-data                  ← W1 ┐
     ├─ tc/w2-engine-services       ← W2 │ in parallel, each a PR
     ├─ tc/w3-ui                    ← W3 │ into tournament-contracts
     └─ tc/w4-dealer                ← W4 ┘
 tournament-contracts → master      ← W5 integrates, one PR to master
```

1. **W0** (`w0-interface.md`) alone. Short. Pushes `tournament-contracts`.
2. **W1–W4** in parallel, each cut from `tournament-contracts` after W0
   lands. File ownership is disjoint; a brief's "Not yours" list is a
   hard boundary. A change another workstream must make goes in the PR
   description under "Needs from W*", never into their files.
3. **W5** (`w5-integration.md`) after W1–W4 merge into
   `tournament-contracts`: integrates, runs every gate, rehearses on a
   preview deploy, opens the PR to `master`.
4. **Release** is Nick's (production Neon snapshot, merge, seed): the
   runbook is 0004 → Release. No agent touches production.

## Every agent

- Read `AGENTS.md`, `docs/decisions/0004-…`, and your brief before code.
  `DESIGN.md` and `PRODUCT.md` too if you touch a screen.
- Gates before you open a PR: `npm run check`, `npm run test:unit`, and
  `npm run test:integration` against a local Postgres
  (`npm run db:test:local`, `DATABASE_URL_TEST=postgresql://$USER@localhost:5432/openmarket_test`).
  Tests of files you don't own may fail until the others land; list
  those failures in the PR, don't fix them by editing someone else's
  files.
- Real data only; no invented rows, figures or copy.
- Delete what the change makes dead. Don't keep a bucket code path "for
  later".
