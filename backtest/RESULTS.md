# Backtest results — what the numbers mean

Run on 2026-10-19 against `events.csv` (14 companies, 56 priced
rounds, Jan 2024 – Oct 19 2026). Reproduce with `python3 analyze.py`.
Parameters: Q = $25k, κ = 1.0, b = $2k, s_floor = 0.05, p_floor = 0.05,
event-flag widening on Tier-1 leaks (spread ×3, Q ÷2, b ÷2, 72 h),
leave-one-out tier prior, Weibull hazard k = 1.6 with λ = 11 / 7
months (mega / red-hot), hazard jump to 0.80 within 60 days of a leak.

## The one-paragraph version

Against an insider who knows every print before any leak, the
five-name dealer book (OpenAI, Anthropic, Anduril, Modal, Instinct)
would have lost about **$53,000 a year** — roughly a fifth of the
~$270,000-a-year bound it carried — and the forward never hit its cap.
Against a trader whose only edge is reading Tier-1 leaks, about
$2,300 a year. The prior landed within sd 0.35 log of the print on
mega-caps and 0.62 on red-hot names; 1 of 45 prints fell outside the
clip.

## Scenarios

| Name | Who trades | What it bounds |
| --- | --- | --- |
| `none` | nobody | prior calibration, void rate, resolution count |
| `at_listing` | an insider who knows the print and hits the cap on the right side at listing, re-entering on every roll | the realistic worst case: pre-leak MNPI |
| `pre_leak` | same insider, 14 days before the leak | identical to `at_listing` in this model (no time value, no inventory skew) |
| `at_leak` | a lawful trader acting the day of the leak, assumed to guess the drift from leak terms to final print correctly every time | an upper bound on leak-reader loss; the dealer has already re-centred and widened |

## Headline table (five listed names, 2.8 years)

| | T = 12 months | T = 3 months |
| --- | --- | --- |
| Forward lives / settled / voided | 18 / 16 / 2 (11%) | 49 / 16 / 33 (67%) |
| Binary quarters / resolved YES | 59 / 16 | 59 / 16 |
| Insider: forward loss total, per settlement, max | $93.8k, $5.9k, $21.9k (Modal Sep 25) | $52.3k, $3.3k, $14.3k |
| Insider: binary loss total, per quarter, max | $54.7k, $0.9k, $5.8k | same |
| Insider total, annualised | **$53k/yr** | $38k/yr |
| Leak-reader: forward loss total | $6.5k ($5.9k of it Modal May 26: leaked $2.5B, printed $4.65B) | $20.4k |
| Bound carried | 16 × $25k + 59 × $6k ≈ $754k → $270k/yr | same |
| Realised insider loss / bound | 20% | 14% |

## Reading each output

- `1_forward_loss_per_print.png` — the forward's realised loss is set
  by how far the print lands from the prior, not by the cap. Four of
  sixteen prints cost nothing: Anthropic Jan 24 and Mar 25 because the
  dealer had re-centred on a leak before the settling life listed;
  both Anduril 2025–26 prints landed within the spread of the 2×
  prior.
- `3_prior_calibration.png` — mega-cap errors are tight (median 0.00,
  sd 0.35); red-hot errors are wide (median +0.12, sd 0.62) and
  include the Harvey/Perplexity prints that came in well under a 3×
  prior. This is σ_tier in the dealer's spread formula.
- `2_void_rate.png` — T = 3 months voids two of every three forward
  lives on these names (OpenAI 67%, Anthropic 58%, Anduril 73%, Modal
  75%, Instinct 25%). Lower insider losses at T = 3 come from lives
  that roll after a leak and list at leaked terms, but collateral sits
  idle most quarters on the mega-caps. Hence per-name T.
- `4_resolutions_per_quarter.png` — the five names produced 16 prints
  in 11 quarters; with the nine analogs, 50. 2026 Q2–Q3 had six prints
  among the five.
- `summary.csv` — every figure above, per scenario × T × group.
- `losses_T12.csv` — per-print forward losses and per-name binary
  losses under each scenario; the source of the "max" cells.
- `calibration.csv` — per-print prior error with tier; σ_tier is its
  sd.

## Two corrections the backtest forced

1. **The binary's bound is not b·ln 2.** That holds only from a 50/50
   start. Against a 10–20% hazard prior an informed YES-buyer takes
   b·ln(1/p); the bound is b·ln(1/p_floor) ≈ $6,000 at defaults. The
   binary bleeds as much as the forward to an insider ($54.7k vs
   $93.8k over the window).
2. **Uniform T = 3 months is wrong for the mega-caps.** Per-name T
   (launch 270/180/270/120/90 days) is the adopted fix.

## Leak coverage

16 of 18 listed-name prints (89%) had a Tier-1 "in talks" report
before the announcement; median lead 47 days (IQR 21–92; range 0–137).
Across all 56 prints: 73%, median 46 days. Leak terms vs final print:
median +2.5%, sd 0.18 log; 8 of 39 missed by more than 20% (OpenAI Oct
24 $100B → $157B; Modal May 26 $2.5B → $4.65B; Cursor Nov 25 $19B →
$29.3B; SSI Apr 25 $20B → $32B; Harvey Jul 24 and Perplexity May 25
closed *below* the leak).

## Caveats

1. Survivorship: every sampled name kept raising at step-ups. A flat
   or down round lands at −0.7 to −1.2 against this prior and costs
   the full cap; the `down_round` scenario is the next thing to run.
2. Instinct's seed and Series A dates are Forge filing dates, disclosed
   retroactively; Anthropic Series D has no dated close (Jan 11 2024
   used as a floor).
3. The leak-reader's binary loss is zero by construction (the dealer
   prices the same information).
4. No time value and no inventory skew in the loss model.
5. Open rounds as of Oct 19 2026 (Anduril ~$100B talks, OpenAI ~$1.4T
   bridge, Mercor $20B, Perplexity $30B) are censored, not counted.

## Still to run

`down_round`, `heat_scaled_q`, `per_name_t`, `b_sweep` — defined in
`../TECHNICAL_DESIGN.md` §10. Adding one is a PR that touches
`sim.py` and this file.
