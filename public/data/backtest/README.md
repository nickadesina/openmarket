# OpenMarket backtest, public outputs

Data through 2026-10-19; rulebook v1.0.0. Reproduced from the backtest
in the OpenMarket repository. The construction of the prior is not
published; these files carry its errors and the contracts' outcomes,
not its inputs.

- `calibration.csv`: one row per forward life that settled on a print
  for the listed names and comparables. `prior_err` is ln(print) minus
  ln(prior mid at listing). Its standard deviation by tier is the
  dispersion the dealer's spread is built on.
- `resolutions.csv`: for each listed name and calendar quarter since
  2024, whether a quarterly timing binary would have resolved yes
  under rulebook v1.
- `void-rates.csv`: per listed name at its launch expiry, how many
  forward lives settled, voided or are open, with the binary's event
  (a priced round, or a public S-1 for the labs).
- `void-rates-uniform-t.csv`: the same names under a uniform expiry of
  3 and 12 months, from the backtest's no-trader scenario.

What the numbers say: the prior landed within about 0.35 log of the
print on mega-cap names and about 0.62 on red-hot names; one print in
forty-five fell outside the clip. A uniform three-month forward expiry
voided two of every three lives on these names, which is why expiry is
set per name.

License: CC BY 4.0, cite OpenMarket.
