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

Results and what they mean: `RESULTS.md`.

Scenarios still to run: `down_round`, `heat_scaled_q`, `per_name_t`,
`b_sweep`. Requires pandas, numpy, matplotlib.
