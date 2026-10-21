# Backtest

Dealer backtest for the two-contract design (`../CONTRACTS.md`,
`../TECHNICAL_DESIGN.md` §10). Jan 2024 – Oct 19 2026, 14 companies,
56 priced rounds.

```
python3 analyze.py            # writes out/summary.csv, out/*.png
python3 analyze.py other.csv  # another events file with the same columns
```

- `sim.py` — prior (leave-one-out tier step-up, Weibull hazard, leak
  overrides), dealer (LMSR binary, clipped forward with cap), scenarios
  `none`, `at_listing`, `pre_leak`, `at_leak`.
- `events.csv` — merged events; `data/*.csv` — per-source pulls with
  conflict notes. Columns: `company, event_type, round_name,
  announcement_date, post_money_usd, amount_raised_usd, lead,
  leak_date, leak_post_money_usd, notes`. Tenders and secondaries are
  recorded but excluded as prints.
- `out/` — committed results from the last run; `RESULTS.md` explains what each file and number means.
- `out/params.json` — every parameter the app reads (`src/lib/config/dealer.ts`),
  with the SHA-256 of `events.csv`, `sim.py` and `analyze.py`. Never edit
  it by hand: rerun, then add a model version with its digest in
  `src/lib/config/dealer.ts`.
  `.github/workflows/backtest.yml` fails if a rerun does not reproduce
  `out/` (charts excluded) and posts `summary.csv` on the PR.
- `golden.py` — writes `out/prior_golden.json`, sim.py's prior on the
  calibration run with its inputs; the app's port
  (`src/lib/engine/dealer/prior.ts`) is tested against it. Run it after
  `analyze.py`.

Headline (five listed names, Q = $25k, κ = 1, b = $2k, p_floor = 0.05,
T = 12 months): insider who knows every print pre-leak ≈ $53k/yr,
about 20% of the bound carried; lawful scoop-reader ≈ $2.3k/yr; the
forward never hit its cap; 16 of 18 listed prints had a Tier-1 leak
first, median 47 days ahead. T = 3 months voids 67% of forward lives,
which is why T is per name.

Scenarios still to run: `down_round`, `heat_scaled_q`, `per_name_t`,
`b_sweep`. Requires pandas, numpy, matplotlib (`pip install -r requirements.txt`).
