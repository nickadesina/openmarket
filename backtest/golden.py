"""Golden cases for the app's port of sim.py's prior.

Writes out/prior_golden.json: every binary quarter, forward life and weekly
dealer mark the calibration run produces for the listed names, each with the
inputs src/lib/engine/dealer/prior.ts needs to recompute it and sim.py's
output. tests/engine/dealer/prior.test.ts asserts agreement to 1e-9.

The run is the one analyze.py takes params.json from (T = 12 months, no
trader, leave-one-out prior, from 2024-01-01, every company). analyze.py is
not imported, since importing it reruns every scenario and rewrites out/; the
listed names are read from the params.json it wrote.

The outputs are sim.py's own rows. This file walks the same print intervals
only to attach each row's inputs, and fails if its walk and sim's rows differ.
"""
import json
import os
import sys
from datetime import date, timedelta

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sim import DATA_THROUGH, Params, binary_expiry, load_events, prints_for, run, tier_of  # noqa: E402

T_MONTHS = 12
SCENARIO = "none"
START = date(2024, 1, 1)

with open(f"{HERE}/out/params.json") as f:
    LISTED = sorted(json.load(f)["prior"]["mu_stepup"])

df = load_events(f"{HERE}/events.csv")
ALL = LISTED + [c for c in df.company.unique() if c not in LISTED]
p = Params(T_months=T_MONTHS)
result = run(df, p, SCENARIO, ALL, loo=True, start=START)
loo = result["loo_prior"]
LIFE_DAYS = int(p.days_per_month * p.T_months)


def iso(d):
    return None if d is None or pd.isna(d) else d.isoformat()


def scoop(nxt):
    """The leak sim reads off the next print: its date and, if one was reported, its valuation."""
    if nxt is None or pd.isna(nxt.leak_date):
        return None, None
    value = float(nxt.leak_post_money_usd) if pd.notna(nxt.leak_post_money_usd) else None
    return nxt.leak_date.date(), value


def forward_listings(t_list, t_print):
    t_roll = t_list
    while True:
        expiry = t_roll + timedelta(days=LIFE_DAYS)
        if t_print is None and expiry > DATA_THROUGH:
            return
        if t_print is not None and not (t_roll < t_print and t_roll <= DATA_THROUGH):
            return
        yield t_roll, expiry
        t_roll = expiry + timedelta(days=1)


def binary_listings(t_list, t_print):
    qd = t_list
    while True:
        qe = binary_expiry(qd)
        if t_print is None and qe > DATA_THROUGH:
            return
        if t_print is not None and qd > min(t_print, DATA_THROUGH):
            return
        yield qd, qe
        if t_print is not None and t_print <= qe:
            return
        qd = qe + timedelta(days=1)


def expected_rows(company):
    """sim's rows for one company, inputs only, in sim's order."""
    binaries, forwards, marks = [], [], []
    ev = prints_for(df, company, include_tenders=False)
    if len(ev) < 2:
        return binaries, forwards, marks
    for i in range(len(ev)):
        last = ev.iloc[i]
        nxt = ev.iloc[i + 1] if i + 1 < len(ev) else None
        last_v = float(last.post_money_usd)
        tier = tier_of(last_v, p)
        mu = loo[(company, tier)]
        base = {"company": company, "tier": tier, "last_print_date": iso(last.announcement_date.date()),
                "last_post_money_usd": last_v}
        t_list = max(last.announcement_date.date(), START)
        t_print = nxt.announcement_date.date() if nxt is not None else None
        leak, leak_v = scoop(nxt)
        for listed, expiry in forward_listings(t_list, t_print):
            forwards.append(base | {"listed": iso(listed), "expiry": iso(expiry), "mu": mu})
        if t_print is not None:  # sim keeps a weekly tape only between two prints
            d = t_list
            while d <= min(t_print, DATA_THROUGH):
                marks.append(base | {"date": iso(d), "mu": mu, "leak_date": iso(leak),
                                     "leak_post_money_usd": leak_v})
                d += timedelta(days=7)
        # after the last print sim applies no leak to the binary
        for listed, expiry in binary_listings(t_list, t_print):
            binaries.append(base | {"listed": iso(listed), "expiry": iso(expiry), "leak_date": iso(leak)})
    return binaries, forwards, marks


def attach(expected, frame, company, dates, output):
    """sim's output column `output` on each expected row, after checking the rows line up."""
    rows = frame[frame.company == company].to_dict("records")
    assert len(rows) == len(expected), (company, output, len(rows), len(expected))
    merged = []
    for want, got in zip(expected, rows):
        for ours, theirs in dates.items():
            assert want[ours] == iso(got[theirs]), (company, ours, want, got)
        assert "tier" not in got or want["tier"] == got["tier"], (company, want, got)
        merged.append(want | {output[0]: float(got[output[1]])})
    return merged


golden = {
    "about": "sim.py's prior for the listed names in the calibration run; written by backtest/golden.py",
    "run": {"T_months": T_MONTHS, "scenario": SCENARIO, "loo": True, "start": START.isoformat(),
            "data_through": DATA_THROUGH.isoformat(), "companies": len(ALL)},
    "binaries": [], "forwards": [], "marks": [],
}
for c in LISTED:
    b, f, m = expected_rows(c)
    golden["binaries"] += attach(b, result["binaries"], c, {"listed": "listed", "expiry": "quarter_end"},
                                 ("p_model", "p_model"))
    golden["forwards"] += attach(f, result["settlements"], c, {"listed": "listed", "expiry": "expiry"},
                                 ("mid0", "mid0"))
    golden["marks"] += attach(m, result["weeks"], c, {"date": "date"}, ("mid", "mid"))

with open(f"{HERE}/out/prior_golden.json", "w") as f:
    json.dump(golden, f, indent=1, sort_keys=True)
    f.write("\n")
print("prior_golden.json written:", {k: len(golden[k]) for k in ("binaries", "forwards", "marks")})
