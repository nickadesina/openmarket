# 0002 — The binary counts any announcement after listing; expiry has a 21-day floor

Date: 2026-10-21. Status: decided. Amends `CONTRACTS.md` → Contract A.

## Question

After an early YES, the successor binary lists the same day. If a
second round is announced later in the same calendar quarter, does it
resolve the successor (literal reading) or do binaries only count
events inside their own quarter?

## Decision

1. **Literal reading.** A binary resolves YES on the first qualifying
   announcement strictly after its listing time and on or before its
   expiry. "Quarter" names the expiry, not an event window. There is
   no dead window: a trader who buys "another round by T" the day
   after a print is paid if another round lands before T, whatever
   quarter it falls in. Instinct (Series A Aug 1, B Aug 26, C Sep 28,
   2026) is the live example: three YES resolutions in one quarter,
   each on a successor listed the day before.
2. **Expiry floor.** A binary's expiry is the current calendar
   quarter-end if at least 21 days remain at listing, otherwise the
   next quarter-end. This keeps every name on the calendar rhythm
   (the scoreboard moves each quarter) without listing a 3-day binary
   at the price floor after a late-quarter print. `TECHNICAL_DESIGN.md`
   §3's "next quarter's binary lists the same day" is replaced by this
   rule.
3. "Strictly after" is by timestamp. Two announcements on the same
   day resolve two binaries only if the second's `published_at` is
   later than the first's, which is what the fixture records.

## Effect on the backtest

`backtest/sim.py` now uses `binary_expiry()` with the 21-day floor
(it previously always used the current quarter). Five listed names,
T = 12 months, insider scenario: binary quarters 59 → 55, YES count
unchanged at 16, binary loss $54.7k → $54.3k, bound carried ≈ $730k
→ $260k/yr, insider share of bound still 20%. `backtest/RESULTS.md`
is updated.

## Effect on the fixture

`tests/fixtures/event-flags.json` needs no change; its `print` rows
already carry `published_at` and the settle job applies the rule.
