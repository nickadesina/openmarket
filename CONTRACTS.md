# Contracts

Normative definition of the two instruments OpenMarket trades per listed
name. `README.md` section 2 records the product decision (D10–D14);
`TECHNICAL_DESIGN.md` says how they are built. Where this file and the
Claude Doc "OpenMarket Contract Specification — Agent & Dependency-Graph
Guide" differ, this file wins once merged.

## Definitions

| Term | Definition |
| --- | --- |
| Listed name | A private company with two live contracts. Launch set: OpenAI, Anthropic, Anduril, Modal, Instinct. |
| Listing rule | Last print ≥ ~$500M; last priced round ≤ 9 months ago; lead of last round identifiable from public record. Scale by adding names, never contract types or states. |
| Print | Post-money of a **priced** primary equity round, publicly reported per the rulebook. For the labs, an IPO first-day-close market cap is also a print. Not: SAFEs, notes, same-price extensions, secondaries, tenders, debt. |
| Announcement | First public, dated statement that a priced round closed. "In talks" reporting is not an announcement. |
| Entry price F₀ | The side of the dealer's quote a position fills at when it opens (ask for a long, bid for a short), in ln USD. Each position carries its own F₀. |
| Expiry T | Binary: calendar quarter-end. Forward: **per name** (`listings.forward_t_days`), rolling. |
| Settlement hierarchy | Published, versioned source ranking. Rank 1 company/lead release; 2 SEC filing; 3 two independent Tier-1 outlets citing closed terms; 4 one Tier-1 outlet. State charter price-per-share re-centres the mid and never settles. |
| Clip κ | Symmetric bound on the forward's payout in log units. Default 1.0 (0.37×–2.72× of F₀). |
| Position cap Q | Max net notional the dealer holds per side per name. Default $25,000. |
| Void | A forward cancelled with full refund because no print occurred by T. A normal outcome, not an error. |

Units: valuations are natural-log USD internally, dollars at the API.
Money is integer cents. Time is UTC.

## Contract A — quarterly timing binary

Pays $1 if the name announces a priced round (labs: files a public S-1)
on or before the current calendar quarter-end. Prices **when**.

- Outcomes YES / NO. Resolves YES on the first qualifying announcement
  **strictly after the binary's listing time** and ≤ T; NO at T + 1 day
  otherwise. "Quarter" names the expiry, not an event window: any
  qualifying announcement between listing and T counts, including a
  second round in the same calendar quarter.
- Expiry T is the current calendar quarter-end if at least 21 days
  remain at listing, otherwise the next quarter-end. The first binary
  for a name lists at listing; each successor lists the same day its
  predecessor resolves or expires (decision 0002).
- LMSR with liquidity b (default $2,000); price clamped to
  [p_floor, 1 − p_floor], p_floor = 0.05. Worst-case house loss per
  quarter is b·ln(1/p_floor) ≈ $6,000 — not b·ln 2, which only holds
  when the house starts at 50/50.
- A round with undisclosed valuation still resolves YES. A same-price
  extension, tender or secondary does not resolve. A confidential S-1
  resolves only when it becomes public before T.

## Contract B — next-print forward

Cash-settled forward on ln(next print), voided with refund if no print
by T. Prices **how big**, conditional on a round.

Payout per unit notional, long position:

    payout = N · clip(ln V − F₀, −κ, +κ)

Short pays the negative. Max gain or loss per position is N·κ.

- Settles on the first print after open with a qualifying post-money
  dated ≤ T, per the hierarchy. A range settles at its midpoint.
  Price-per-share alone does not settle.
- Undisclosed valuation: wait up to T for a qualifying post-money, then
  void. Revision by a higher-ranked source within 7 days supersedes.
- Down rounds settle normally; shorts are paid.
- Acquisition before a print settles only if a cash-equivalent equity
  value is disclosed; otherwise void.
- Collateral: N·κ posted at open, released at settlement or void.
- On settlement a new forward lists with the dealer's first quote
  anchored on the print; on void, at the current mid. T resets.

Launch T (days): OpenAI 270, Anthropic 180, Anduril 270, Modal 120,
Instinct 90. The backtest proposes revisions from realised cadence; an
operator applies them.

## Why two contracts

A single blended forward (settle flat if no round) prices
P(round) × E[step-up | round] in one number, hides the hazard, and pays
nobody for calling a stall. Separation costs one extra price per name
and gives the API two numbers nobody else publishes: a quarterly hazard
and a conditional valuation.

## The dealer

The venue always quotes both contracts. Forward quote around the model
mid m with inventory I and risk aversion γ (default 0.5):

    m̃ = m − γ·κ·I/Q        s = s_floor + σ_tier·|I|/Q
    bid = m̃ − s             ask = m̃ + s

s_floor = 0.05; σ_tier = prior-error sd (0.35 mega-cap, 0.62 red-hot).
The side whose fill would breach Q is pulled.

Event flags (Tier-1 scoop, Form D, charter amendment, "closing"
statement): the forward's s × 3 and Q ÷ 2 for new positions, until the
model re-prices or 72 h pass. The binary is seeded once per quarter at
the model p with a fixed b and is not re-centred or re-scaled
mid-quarter, so its bound stays b·ln(1/p_floor).

Hard loss bound per name: Q·κ per forward settlement plus
b·ln(1/p_floor) per binary quarter. Five names at defaults, ~2
settlements and 4 quarters a year each: ≈ $370k/yr worst case. The
backtest (`backtest/`) puts the realised insider loss near 20% of the
bound carried.

Restricted persons: employees, directors and investors of a listed name
may not trade it. Attestation at sign-in in play money; KYC-backed
later.

## Lifecycle

quoting → widened (flag) → quoting (re-price or 72 h)
quoting | widened → resolved (qualifying event ≤ T) → roll
quoting | widened → expired (T passes) → roll
(binary: expired pays NO; forward: expired voids with refund)

## Tournament mapping

A tournament question is one of the two contracts, nothing else
(decision 0004). There are no buckets and no floor: "nothing by
expiry" is NO on A and a void on B, as the contracts already say.

| Contract | Question | Forecast | Resolves | Score |
| --- | --- | --- | --- | --- |
| A | "Does [Name] announce a priced round / file an S-1 by [quarter-end]?" | one probability p of YES | YES, or NO (anything else, including nothing by T) | the n = 2 log score 100/ln 2 · ln(2 · max(p_outcome, ε)), ε = 0.001, time-averaged over the open window |
| B | "What will [Name]'s next post-money be?" | one level x > 0 in the question's unit ($B, or $T from a $1T listing mid) | the settling post-money y in that unit, or **void** with the forward | max(100 · (1 − \|ln(x/y)\| / ln 2), −896.6), time-averaged over the open window; unscored if the forward voids |

Time before a forecaster's first forecast scores 0 on both (A: "said
50%"; B: "missed by 2×"); exact is 100 on both.

Forecasts are append-only rows; every score and aggregate is
recomputable from them. The crowd aggregate is one number: on A the
pooled P(YES) (geometric mean of odds, extremized), on B the median of
the forecasters' ln x. It is a component of the published reference
price (A: P(YES); B: the median as ln USD) once ≥ 10 forecasters are on
a question.

## Not open

Two contracts per name; void-and-refund on no print; log units; the
dealer always quotes; scaling by names not states; parameters come from
the backtest, not by hand.
