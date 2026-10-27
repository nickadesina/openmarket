"""
Uniform-loss AMM vs the two-outcome LMSR on the quarterly binary.

A comparison, not a rerun: params.json and every published parameter are
read, never written. It prices the binaries sim.py already simulates (the
same seed p, quarter-ends and outcomes analyze.py uses) under two pricing
functions with the same loss budget per binary quarter, and writes
out/uniform_loss_comparison.csv.

Pricing functions (Moallemi, Robinson and Zhu, "Uniform-Loss Automated Market
Making for Prediction Markets", arXiv 2607.17428, section 3.1 and 4.2), in the
paper's reserve form: a pool holds X YES and Y NO tokens, arbitraged to the
fair price p, with pool value V(p) and reserves
    X(p) = V(p) + (1 - p) V'(p),   Y(p) = V(p) - p V'(p).
  LMSR      V(p) = L H(p),          X = -L ln p,   Y = -L ln(1 - p)   (L = b)
  uniform   V(p) = L phi(Phi^-1(p)), the PM-AMM for Gaussian score dynamics:
            X = L [phi(z) - (1 - p) z],  Y = L [phi(z) + p z],  z = Phi^-1(p)

Loss to the house when the price moves from p0 to p1 and the binary resolves:
X(p0) - X(p1) on YES, Y(p0) - Y(p1) on NO (the pool trades token for token;
its YES tokens pay $1 on YES). Pushed all the way to the outcome this is
X(p0) on YES, the LMSR's b ln(1/p0), which is what sim.py books.

Same loss budget: L for the uniform AMM is set so its worst case over seed
prices in [p_floor, 1 - p_floor] equals the LMSR's, b ln(1/p_floor) (README
D12). X is decreasing in p, so the worst case is X(p_floor).

Scenarios, on sim.py's binaries:
  at_listing  an insider knows the outcome and pushes the price to it.
  at_leak     a lawful trader acts on a Tier-1 leak dated inside the binary's
              life: the price moves from the seed p to the dealer's own
              post-leak hazard, and the binary then resolves. sim.py books
              zero binary loss here (it reprices a leak only before a
              quarter's seed); this prices the move a seeded binary would
              take. A leak before the seed is already in p, so no trade.

Usage: python3 backtest/uniform_loss_vs_lmsr.py
"""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import date, timedelta
from statistics import NormalDist

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sim import Params, load_events, prints_for, run  # noqa: E402

OUT = os.path.join(HERE, "out", "uniform_loss_comparison.csv")
START = date(2024, 1, 1)  # analyze.py's sample start
N = NormalDist()


def lmsr_reserves(p: float, L: float) -> tuple[float, float]:
    return -L * math.log(p), -L * math.log(1 - p)


def uniform_reserves(p: float, L: float) -> tuple[float, float]:
    z = N.inv_cdf(p)
    phi = N.pdf(z)
    return L * (phi - (1 - p) * z), L * (phi + p * z)


def lmsr_value(p: float, L: float) -> float:
    return -L * (p * math.log(p) + (1 - p) * math.log(1 - p))


def uniform_value(p: float, L: float) -> float:
    return L * N.pdf(N.inv_cdf(p))


def loss(reserves, p0: float, p1: float | None, yes: bool, L: float) -> float:
    """House loss from p0 to p1 (None: pushed to the outcome), on the outcome."""
    x0, y0 = reserves(p0, L)
    x1, y1 = (0.0, 0.0) if p1 is None else reserves(p1, L)
    return (x0 - x1) if yes else (y0 - y1)


def leak_for(df: pd.DataFrame, company: str, listed: date) -> tuple[date | None, date | None]:
    """The leak and print of the interval a binary listed on `listed` sits in."""
    ev = prints_for(df, company, include_tenders=False)
    dates = [d.date() for d in ev.announcement_date]
    later = [i for i, d in enumerate(dates) if d > listed]
    if not later:
        return None, None
    nxt = ev.iloc[later[0]]
    leak = nxt.leak_date.date() if pd.notna(nxt.leak_date) else None
    return leak, nxt.announcement_date.date()


def main() -> None:
    params = json.load(open(os.path.join(HERE, "out", "params.json")))
    p = Params()
    b, p_floor = params["dealer"]["b_usd"], params["dealer"]["p_floor"]
    if (b, p_floor) != (p.b, p.p_floor):
        raise SystemExit("params.json and sim.py disagree on b or p_floor; rerun analyze.py first")
    budget = b * math.log(1 / p_floor)
    L_uniform = budget / uniform_reserves(p_floor, 1.0)[0]
    listed_names = set(params["forward_t_days"])

    df = load_events(os.path.join(HERE, "events.csv"))
    companies = list(dict.fromkeys(list(params["forward_t_days"]) + list(df.company.unique())))
    binaries = run(df, p, "at_listing", companies, loo=True, start=START)["binaries"]

    rows = []
    for _, r in binaries.iterrows():
        listed, qe, p0, yes = r.listed, r.quarter_end, float(r.p_model), bool(r.outcome_yes)
        base = {
            "company": r.company,
            "group": "listed" if r.company in listed_names else "analog",
            "listed": listed,
            "quarter_end": qe,
            "outcome": "yes" if yes else "no",
            "p_seed": p0,
            "lmsr_expected_usd": lmsr_value(p0, b),
            "uniform_expected_usd": uniform_value(p0, L_uniform),
        }
        rows.append({**base, "scenario": "at_listing", "p_after": 1.0 if yes else 0.0,
                     "lmsr_loss_usd": loss(lmsr_reserves, p0, None, yes, b),
                     "uniform_loss_usd": loss(uniform_reserves, p0, None, yes, L_uniform)})
        leak, _ = leak_for(df, r.company, listed)
        if leak is not None and listed < leak <= qe:
            hazard = p.leak_hazard_60d if (qe - leak).days <= p.leak_window_days else p.leak_hazard_far
            p1 = min(max(max(p0, hazard), p_floor), 1 - p_floor)
        else:
            p1 = p0
        rows.append({**base, "scenario": "at_leak", "p_after": p1,
                     "lmsr_loss_usd": loss(lmsr_reserves, p0, p1, yes, b),
                     "uniform_loss_usd": loss(uniform_reserves, p0, p1, yes, L_uniform)})

    out = pd.DataFrame(rows)[[
        "scenario", "group", "company", "listed", "quarter_end", "outcome", "p_seed", "p_after",
        "lmsr_loss_usd", "uniform_loss_usd", "lmsr_expected_usd", "uniform_expected_usd",
    ]].sort_values(["scenario", "group", "company", "quarter_end", "listed"], kind="stable")
    out["loss_budget_usd"] = budget
    out["lmsr_L"] = b
    out["uniform_L"] = L_uniform
    out.to_csv(OUT, index=False, float_format="%.6f")

    print(f"wrote {OUT} ({len(out)} rows); budget per quarter {budget:,.0f}, uniform L {L_uniform:,.1f}")
    summary = out.groupby(["scenario", "group"]).agg(
        quarters=("outcome", "size"),
        yes=("outcome", lambda s: int((s == "yes").sum())),
        lmsr_total=("lmsr_loss_usd", "sum"),
        uniform_total=("uniform_loss_usd", "sum"),
        lmsr_max=("lmsr_loss_usd", "max"),
        uniform_max=("uniform_loss_usd", "max"),
    )
    print(summary.round(0).to_string())


if __name__ == "__main__":
    main()
