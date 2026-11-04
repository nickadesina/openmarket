# 0003 — Decisions after the first build pass

Date: 2026-10-22. Status: decided. Answers the four open items the
implementer handed back, and ranks the five pieces left out of the
milestones.

## Decided

1. **Evidence bonus.** Not score points. A confirmed first flag (a
   user-submitted URL that an independent ingest flag later confirms,
   with the user's `published_at` earlier) adds one to a separate
   `scout_count` on the forecaster, shown as its own leaderboard
   column; the prize pool, not the scoring rule, decides what a scout
   point is worth. Max one per event per user. Mixing a bounty into the
   log score would make calibration unreadable, which is the one thing
   the leaderboard exists to show.
2. **Crowd weight is a ramp, not a step.** Replace
   `w_c = min(0.3, n/(n+n₀))·[n ≥ N_min]` with
   `w_c = 0.3 · clamp((n − 10) / 30, 0, 1)`: zero below 10
   forecasters, 0.3 at 40 and above, linear between. Bump
   `blend_version`. `w_t` is unchanged.
3. **Early close: allowed.** A binary question closes and resolves YES
   on the announcement's public time; a forward ladder closes on the
   print's public time. Both back-date `closes_at` to the document's
   time, as the tournament spec already says; later forecasts stay in
   the log and are not scored. This mirrors Contract A's early YES and
   Contract B's settlement, so the tournament and the dealer never
   disagree about when a question ended.
4. **D5 (ladder tail floor) is closed by D11.** The ladder is a display
   drawn from the forward mid and σ_tier as a lognormal over the
   universal grid; there is no seeded floor to choose. Remove the floor
   constant from `seed.ts` when the old ladder markets are delisted.
   README D5 → "Closed: moot once the ladder stopped trading."

## The five left-out pieces, ranked

| Build? | Item | Why |
| --- | --- | --- |
| Yes, before real money, and before the first print | Correcting a provisional settlement inside the 7-day window | The rulebook promises it; a settlement that cannot be amended is a rulebook violation, and the first print will test it |
| Yes, small | Admin actions on the rank 3–4 queue (approve / reject / defer, with the source URL) | Without it a rank-3 print never settles; the queue is a dead letter |
| Yes, as a gate on first trade, not at sign-in | Attestation | Restricted persons must attest before they can trade a name; a profile field nobody fills in is not an attestation. One modal before the first fill, stored with a timestamp |
| Yes, trivial | `api-key:revoke` | A key that cannot be revoked should not be issued |
| No, not yet | Evidence form on question pages | The API route exists; add the form when a question has ≥ 10 forecasters and someone has actually used the route by hand |

## Production listings

Seeding needs the production `DATABASE_URL_UNPOOLED`, which neither
agent environment can reach (Neon host not on the allowlist). Nick runs
it once:

```
DATABASE_URL_UNPOOLED=<production> npm run seed:listings -- --listed-at=<ISO now>
```

After that the dealer job lists the ten instruments and their
tournament questions on its own run. Nothing else is waiting on it.
