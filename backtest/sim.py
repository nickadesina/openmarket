"""
OpenMarket dealer backtest.

Instruments per listed name (see contract spec):
  A  quarterly binary: "priced round announced by quarter-end" (S-1 for labs)
     LMSR with liquidity b.  House loss vs an informed trader = b * ln(1/p_outcome).
  B  next-print forward on ln(post-money), clip kappa, void if no print by T.
     Dealer quotes mid +/- s around a model mid; position cap Q per side.
     House loss vs an informed trader taking the cap on the right side
        = Q * clip(|ln V - mid| - s, 0, kappa)

Scenarios
  none       : no traders -> P&L 0; used for calibration and void-rate stats
  at_listing : informed trader knows the print and hits the cap at listing (worst case)
  pre_leak   : informed trader hits the cap `pre_leak_days` before the leak (insider)
  at_leak    : informed trader acts on the leak the same day (lawfully informed);
               dealer has re-centred to leak terms and widened

Prior
  mid_0 = ln(last_print) + mu_stepup(tier)
  hazard: time-to-next-round ~ Weibull(shape k, scale lam(tier)); P(round in (t, t+dt] | survived to t)
  Optional empirical (leave-one-out) prior: mu_stepup = median realized log step-up of OTHER names in tier.
"""
from __future__ import annotations
import math
from dataclasses import dataclass, field
from datetime import date, timedelta
import pandas as pd
import numpy as np

# ---------------------------------------------------------------- parameters
@dataclass
class Params:
    kappa: float = 1.0          # clip, log units
    Q: float = 25_000.0         # position cap per side, USD notional
    b: float = 2_000.0          # LMSR liquidity per binary
    s_floor: float = 0.05       # half-spread floor, log units
    gamma: float = 0.5          # risk aversion (inventory skew) - unused with single informed hit
    flag_spread_mult: float = 3.0
    flag_q_mult: float = 0.5
    flag_b_mult: float = 0.5
    flag_days: int = 72 // 24 * 1  # 72h -> 3 days
    p_floor: float = 0.05       # binary price floor/ceiling
    T_months: int = 3           # forward expiry
    pre_leak_days: int = 14
    # prior
    mu_stepup: dict = field(default_factory=lambda: {"mega": math.log(1.7), "redhot": math.log(2.5)})
    sigma_stepup: dict = field(default_factory=lambda: {"mega": 0.45, "redhot": 0.6})
    cadence_months: dict = field(default_factory=lambda: {"mega": 11.0, "redhot": 7.0})
    weibull_k: float = 1.6      # >1: hazard rises with time since last round
    mega_threshold: float = 10e9
    leak_hazard_60d: float = 0.80  # P(announce within 60d | Tier-1 leak)


def tier_of(last_print: float, p: Params) -> str:
    return "mega" if last_print >= p.mega_threshold else "redhot"


def weibull_surv(t_months: float, k: float, lam: float) -> float:
    return math.exp(-((max(t_months, 0.0) / lam) ** k))


def p_round_by(t_now_m: float, t_end_m: float, k: float, lam: float) -> float:
    """P(next round in (t_now, t_end] | survived to t_now), t in months since last print."""
    s_now = weibull_surv(t_now_m, k, lam)
    s_end = weibull_surv(t_end_m, k, lam)
    if s_now <= 0:
        return 1.0
    return max(0.0, min(1.0, 1 - s_end / s_now))


def quarter_end(d: date) -> date:
    q = (d.month - 1) // 3
    m = 3 * (q + 1)
    y = d.year
    if m == 12:
        return date(y, 12, 31)
    return date(y, m + 1, 1) - timedelta(days=1)


def months_between(a: date, b: date) -> float:
    return (b - a).days / 30.4375


# ---------------------------------------------------------------- data
def load_events(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["announcement_date", "leak_date"])
    df = df[df.event_type.isin(["priced_round", "ipo", "tender_or_secondary"])].copy()
    df = df.sort_values(["company", "announcement_date"]).reset_index(drop=True)
    return df


def prints_for(df: pd.DataFrame, company: str, include_tenders: bool) -> pd.DataFrame:
    sub = df[df.company == company]
    if not include_tenders:
        sub = sub[sub.event_type != "tender_or_secondary"]
    return sub.reset_index(drop=True)


# ---------------------------------------------------------------- core sim
def simulate_company(df: pd.DataFrame, company: str, p: Params, scenario: str,
                     include_tenders: bool = False, loo_prior: dict | None = None,
                     start: date | None = None, end: date = date(2026, 10, 19)) -> dict:
    ev = prints_for(df, company, include_tenders)
    if len(ev) < 2:
        return {"company": company, "settlements": [], "binaries": [], "weeks": []}
    settlements, binaries, weeks = [], [], []

    # iterate over consecutive prints: each interval is one forward life (with rolls)
    for i in range(len(ev) - 1):
        last = ev.iloc[i]
        nxt = ev.iloc[i + 1]
        last_v = float(last.post_money_usd)
        next_v = float(nxt.post_money_usd)
        t_list = last.announcement_date.date()
        if start and t_list < start:
            t_list = start
        t_print = nxt.announcement_date.date()
        leak = nxt.leak_date.date() if pd.notna(nxt.leak_date) else None
        leak_v = float(nxt.leak_post_money_usd) if "leak_post_money_usd" in nxt and pd.notna(nxt.leak_post_money_usd) else None
        tier = tier_of(last_v, p)
        mu = (loo_prior or {}).get((company, tier), p.mu_stepup[tier])
        lam = p.cadence_months[tier]
        ln_last = math.log(last_v)
        ln_next = math.log(next_v)

        # ---- forward lives: roll every T months from listing until print
        t_roll = t_list
        while t_roll < t_print and t_roll <= end:
            T_end = t_roll + timedelta(days=int(30.4375 * p.T_months))
            mid0 = ln_last + mu
            voided = t_print > T_end
            settlements.append({
                "company": company, "tier": tier, "listed": t_roll, "expiry": T_end,
                "print_date": t_print if not voided else None, "voided": voided,
                "mid0": mid0, "ln_last": ln_last, "ln_print": ln_next,
                "prior_err": (ln_next - mid0) if not voided else None,
            })
            t_roll = T_end + timedelta(days=1)

        # ---- dealer state on a date
        def dealer_state(d: date):
            flagged = leak is not None and leak <= d <= leak + timedelta(days=p.flag_days)
            recentred = leak is not None and d >= leak and leak_v is not None
            mid = (math.log(leak_v) if recentred else ln_last + mu)
            s = p.s_floor * (p.flag_spread_mult if flagged else 1.0)
            Q = p.Q * (p.flag_q_mult if flagged else 1.0)
            return mid, s, Q, flagged

        # ---- weekly tape
        d = t_list
        while d <= min(t_print, end):
            mid, s, Q, flagged = dealer_state(d)
            weeks.append({"company": company, "date": d, "mid": mid, "s": s, "flagged": flagged,
                          "ln_print": ln_next, "months_since": months_between(last.announcement_date.date(), d)})
            d += timedelta(days=7)

        # ---- informed trader: re-enters on every roll; only the settling life pays out
        if scenario == "at_listing":
            trigger = t_list
        elif scenario == "pre_leak":
            trigger = (leak - timedelta(days=p.pre_leak_days)) if leak is not None else t_list
        elif scenario == "at_leak":
            trigger = leak  # None -> lawful trader has nothing to act on
        else:
            trigger = None
        for s_ in settlements:
            if s_["company"] != company or s_["voided"] or s_["print_date"] != t_print:
                continue
            s_.setdefault("loss_fwd", 0.0)
            if trigger is None or trigger > s_["expiry"]:
                continue
            hit_date = max(trigger, s_["listed"])
            mid, s, Q, flagged = dealer_state(hit_date)
            edge = abs(ln_next - mid) - s
            s_["loss_fwd"] = Q * max(0.0, min(p.kappa, edge))
            s_["hit_date"] = hit_date
            s_["hit_mid"] = mid
            s_["hit_edge"] = edge
        for s_ in settlements:
            s_.setdefault("loss_fwd", 0.0)

        # ---- binaries: one per quarter between listing and print
        qd = t_list
        while qd <= min(t_print, end):
            qe = quarter_end(qd)
            t_now = months_between(last.announcement_date.date(), qd)
            t_qe = months_between(last.announcement_date.date(), qe)
            p_model = p_round_by(t_now, t_qe, p.weibull_k, lam)
            # leak before quarter start? then hazard jumps
            if leak is not None and leak <= qd:
                p_model = max(p_model, p.leak_hazard_60d if (qe - leak).days <= 60 else 0.95)
            p_model = min(max(p_model, p.p_floor), 1 - p.p_floor)
            outcome_yes = t_print <= qe
            b = p.b
            if scenario in ("none", "at_leak"):
                # no trader, or a trader whose only information is the leak the dealer has
                # already priced in: expected adverse-selection loss is zero (model risk aside)
                loss_bin = 0.0
            else:
                # insider knows the outcome and pushes the price to it
                loss_bin = b * math.log(1.0 / (p_model if outcome_yes else 1 - p_model))
            binaries.append({"company": company, "tier": tier, "quarter_end": qe, "listed": qd,
                             "p_model": p_model, "outcome_yes": outcome_yes, "loss_bin": loss_bin,
                             "early_resolved": outcome_yes})
            if outcome_yes:
                break
            qd = qe + timedelta(days=1)

    # ---- open interval after the last print: lives that expired with no print are voids,
    #      quarters that ended with no announcement are NO resolutions (censored at `end`)
    last = ev.iloc[-1]
    last_v = float(last.post_money_usd)
    t_list = last.announcement_date.date()
    if start and t_list < start:
        t_list = start
    tier = tier_of(last_v, p)
    mu = (loo_prior or {}).get((company, tier), p.mu_stepup[tier])
    lam = p.cadence_months[tier]
    t_roll = t_list
    while True:
        T_end = t_roll + timedelta(days=int(30.4375 * p.T_months))
        if T_end > end:
            break
        settlements.append({"company": company, "tier": tier, "listed": t_roll, "expiry": T_end,
                            "print_date": None, "voided": True, "mid0": math.log(last_v) + mu,
                            "ln_last": math.log(last_v), "ln_print": None, "prior_err": None, "loss_fwd": 0.0})
        t_roll = T_end + timedelta(days=1)
    qd = t_list
    while quarter_end(qd) <= end:
        qe = quarter_end(qd)
        t_now = months_between(last.announcement_date.date(), qd)
        t_qe = months_between(last.announcement_date.date(), qe)
        p_model = min(max(p_round_by(t_now, t_qe, p.weibull_k, lam), p.p_floor), 1 - p.p_floor)
        loss_bin = 0.0 if scenario in ("none", "at_leak") else p.b * math.log(1.0 / (1 - p_model))
        binaries.append({"company": company, "tier": tier, "quarter_end": qe, "listed": qd,
                         "p_model": p_model, "outcome_yes": False, "loss_bin": loss_bin, "early_resolved": False})
        qd = qe + timedelta(days=1)

    return {"company": company, "settlements": settlements, "binaries": binaries, "weeks": weeks}


def run(df: pd.DataFrame, p: Params, scenario: str, companies: list[str], include_tenders=False,
        loo: bool = False, start: date | None = None) -> dict:
    loo_prior = None
    if loo:
        loo_prior = {}
        rows = []
        for c in companies:
            ev = prints_for(df, c, include_tenders)
            for i in range(len(ev) - 1):
                last_v = float(ev.iloc[i].post_money_usd); nv = float(ev.iloc[i + 1].post_money_usd)
                rows.append((c, tier_of(last_v, p), math.log(nv / last_v)))
        r = pd.DataFrame(rows, columns=["company", "tier", "lsu"])
        for c in companies:
            for t in ["mega", "redhot"]:
                others = r[(r.company != c) & (r.tier == t)].lsu
                loo_prior[(c, t)] = float(others.median()) if len(others) else p.mu_stepup[t]
    out = {"settlements": [], "binaries": [], "weeks": []}
    for c in companies:
        res = simulate_company(df, c, p, scenario, include_tenders, loo_prior, start)
        for k in out:
            out[k].extend(res[k])
    return {k: pd.DataFrame(v) for k, v in out.items()} | {"loo_prior": loo_prior}
