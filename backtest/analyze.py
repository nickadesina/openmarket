"""Run scenarios on the merged events file and produce charts + tables."""
import sys, math, json, hashlib
from datetime import date
import pandas as pd, numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
sys.path.insert(0, __import__("os").path.dirname(__file__))
from sim import DATA_THROUGH, MIN_BINARY_DAYS, Params, load_events, run

HERE = __import__("os").path.dirname(__import__("os").path.abspath(__file__))
EVENTS = sys.argv[1] if len(sys.argv) > 1 else f"{HERE}/events.csv"
OUT = f"{HERE}/out"
import os; os.makedirs(OUT, exist_ok=True)

# palette (dataviz reference, light)
C = {"blue": "#2a78d6", "orange": "#eb6834", "aqua": "#1baf7a", "yellow": "#eda100",
     "ink": "#0b0b0b", "ink2": "#52514e", "muted": "#898781", "grid": "#e1e0d9", "axis": "#c3c2b7",
     "surface": "#fcfcfb", "critical": "#d03b3b"}
plt.rcParams.update({"font.family": "sans-serif", "axes.edgecolor": C["axis"], "axes.labelcolor": C["ink2"],
                     "xtick.color": C["muted"], "ytick.color": C["muted"], "axes.spines.top": False,
                     "axes.spines.right": False, "figure.facecolor": C["surface"], "axes.facecolor": C["surface"],
                     "grid.color": C["grid"], "axes.grid": True, "axes.grid.axis": "y", "font.size": 10, "axes.axisbelow": True})

df = load_events(EVENTS)
LISTED = ["OpenAI", "Anthropic", "Anduril", "Modal", "Instinct"]
# Launch forward expiry per listed name, in days (README D11). A proposal the
# harness carries until the per_name_t scenario computes it; an operator
# applies it to listings.forward_t_days.
FORWARD_T_DAYS = {"OpenAI": 270, "Anthropic": 180, "Anduril": 270, "Modal": 120, "Instinct": 90}
ANALOGS = [c for c in df.company.unique() if c not in LISTED]
ALL = LISTED + ANALOGS
START = date(2024, 1, 1)

results = {}
for T in (3, 12):
    for sc in ("none", "at_listing", "pre_leak", "at_leak"):
        p = Params(T_months=T)
        r = run(df, p, sc, ALL, loo=True, start=START)
        results[(T, sc)] = r

p0 = Params()
bound_fwd = p0.Q * p0.kappa
bound_bin_uniform = p0.b * math.log(2)
bound_bin_floor = p0.b * math.log(1 / p0.p_floor)

# ---------------------------------------------------------------- table 1: loss per settlement (T=12, listed names)
rows = []
for sc in ("at_listing", "pre_leak", "at_leak"):
    s = results[(12, sc)]["settlements"]; b = results[(12, sc)]["binaries"]
    s = s[~s.voided]
    for _, x in s.iterrows():
        rows.append({"scenario": sc, "company": x.company, "tier": x.tier, "print_date": x.print_date,
                     "prior_err": x.prior_err, "loss_fwd": x.loss_fwd})
    bl = b.groupby("company").loss_bin.sum()
    for c, v in bl.items():
        rows.append({"scenario": sc, "company": c, "tier": None, "print_date": None, "prior_err": None, "loss_bin_total": v})
tab = pd.DataFrame(rows)
tab.to_csv(f"{OUT}/losses_T12.csv", index=False)

summary = []
for T in (3, 12):
    for sc in ("at_listing", "pre_leak", "at_leak"):
        s = results[(T, sc)]["settlements"]; b = results[(T, sc)]["binaries"]
        for grp, names in (("listed", LISTED), ("analogs", ANALOGS), ("all", ALL)):
            ss = s[s.company.isin(names)]; bb = b[b.company.isin(names)]
            n_set = int((~ss.voided).sum()); n_void = int(ss.voided.sum())
            summary.append({"T_months": T, "scenario": sc, "group": grp,
                            "settlements": n_set, "voids": n_void,
                            "void_rate": n_void / max(1, len(ss)),
                            "fwd_loss_total": ss.loss_fwd.sum(),
                            "fwd_loss_per_settlement": ss.loss_fwd.sum() / max(1, n_set),
                            "fwd_loss_max": ss.loss_fwd.max() if len(ss) else 0,
                            "bin_quarters": len(bb), "bin_yes": int(bb.outcome_yes.sum()),
                            "bin_loss_total": bb.loss_bin.sum(),
                            "bin_loss_per_quarter": bb.loss_bin.sum() / max(1, len(bb)),
                            "bin_loss_max": bb.loss_bin.max() if len(bb) else 0})
summary = pd.DataFrame(summary)
summary.to_csv(f"{OUT}/summary.csv", index=False)
print(summary.round(3).to_string())

# ---------------------------------------------------------------- calibration (no-trader, T=12, all names, LOO prior)
s = results[(12, "none")]["settlements"]; s = s[~s.voided].copy()
s["pred"] = s.mid0 - s.ln_last; s["real"] = s.ln_print - s.ln_last
s.to_csv(f"{OUT}/calibration.csv", index=False)
print("\nLOO prior:", {k: round(v, 3) for k, v in results[(12, "none")]["loo_prior"].items() if k[0] in LISTED})
print("prior error (ln_print - mid0): mean %.3f  median %.3f  sd %.3f  n=%d" % (s.prior_err.mean(), s.prior_err.median(), s.prior_err.std(), len(s)))
print("share of |err| > kappa:", (s.prior_err.abs() > p0.kappa).mean())

# ---------------------------------------------------------------- charts
def savefig(fig, name):
    fig.tight_layout(); fig.savefig(f"{OUT}/{name}.png", dpi=180, facecolor=C["surface"]); plt.close(fig)

# 1. house loss per settlement vs bound, listed names, T=12, three scenarios
fig, ax = plt.subplots(figsize=(9, 4.2))
sets = results[(12, "at_listing")]["settlements"]; sets = sets[(~sets.voided) & sets.company.isin(LISTED)].reset_index(drop=True)
SHORT = {"OpenAI": "OAI", "Anthropic": "ANTH", "Anduril": "ANDL", "Modal": "MODL", "Instinct": "INST"}
labels = [f"{SHORT[r.company]}\n{r.print_date:%b %y}" for r in sets.itertuples()]
x = np.arange(len(sets)); w = 0.38
for i, (sc, col, lab) in enumerate((("at_listing", C["blue"], "insider: knows the print before any leak"), ("at_leak", C["orange"], "leak-reader who guesses direction right (upper bound)"))):
    ss = results[(12, sc)]["settlements"]; ss = ss[(~ss.voided) & ss.company.isin(LISTED)].reset_index(drop=True)
    ax.bar(x + (i - 0.5) * w, ss.loss_fwd / 1000, w, color=col, label=lab, linewidth=0)
ax.axhline(bound_fwd / 1000, color=C["critical"], lw=1.2, ls="--"); ax.text(len(sets) - 0.5, bound_fwd / 1000 + 0.4, f"cap × clip = ${bound_fwd/1000:.0f}k", ha="right", color=C["critical"], fontsize=9)
ax.set_xticks(x); ax.set_xticklabels(labels, fontsize=8); ax.set_ylabel("house loss on the forward, $k")
ax.set_title("Forward: what the house pays an informed trader, per print (Q=$25k, κ=1, T=12mo)", loc="left", fontsize=11, color=C["ink"])
ax.set_ylim(0, 32); ax.legend(frameon=False, fontsize=9, loc="upper left")
savefig(fig, "1_forward_loss_per_print")

# 2. void rate T=3 vs T=12 per listed name (no-trader)
fig, ax = plt.subplots(figsize=(7, 3.6))
vr = []
for T in (3, 12):
    ss = results[(T, "none")]["settlements"]
    g = ss[ss.company.isin(LISTED)].groupby("company").voided.agg(["mean", "count"]).reindex(LISTED)
    vr.append(g)
x = np.arange(len(LISTED)); w = 0.36
ax.bar(x - w/2, vr[0]["mean"] * 100, w, color=C["blue"], label="T = 3 months", linewidth=0)
ax.bar(x + w/2, vr[1]["mean"] * 100, w, color=C["orange"], label="T = 12 months", linewidth=0)
for i in range(len(LISTED)):
    ax.text(x[i] - w/2, vr[0]["mean"].iloc[i] * 100 + 1.5, f"{vr[0]['count'].iloc[i]:.0f} lives", ha="center", fontsize=7.5, color=C["ink2"])
    ax.text(x[i] + w/2, vr[1]["mean"].iloc[i] * 100 + 1.5, f"{vr[1]['count'].iloc[i]:.0f}", ha="center", fontsize=7.5, color=C["ink2"])
ax.set_xticks(x); ax.set_xticklabels(LISTED); ax.set_ylabel("share of forward lives that void, %"); ax.set_ylim(0, 105)
ax.set_title("Forward void rate by expiry, Jan 2024–Oct 2026", loc="left", fontsize=11, color=C["ink"])
ax.legend(frameon=False, fontsize=9)
savefig(fig, "2_void_rate")

# 3. prior error strip plot
fig, ax = plt.subplots(figsize=(8.5, 3.6))
rng = np.random.default_rng(3)
for yi, (tier, col, lab) in enumerate((("redhot", C["orange"], "red-hot (last print < $10B)"), ("mega", C["blue"], "mega-cap (last print ≥ $10B)"))):
    q = s[s.tier == tier]
    yj = yi + rng.uniform(-0.18, 0.18, len(q))
    ax.scatter(q.prior_err, yj, s=46, color=col, edgecolor=C["surface"], linewidth=1.2, zorder=3, label=f"{lab}, n={len(q)}")
    ax.text(-1.55, yi + 0.3, f"median {q.prior_err.median():+.2f}  sd {q.prior_err.std():.2f}", fontsize=8.5, color=C["ink2"])
    for r in q[q.prior_err.abs() > 0.95].itertuples():
        ax.annotate(f"{r.company} {r.print_date:%b %y}", (r.prior_err, yj[q.index.get_loc(r.Index)]), textcoords="offset points", xytext=(0, 9), fontsize=7, color=C["ink2"], ha="center")
for v, lab in ((0, "prior"), (-p0.kappa, "clip −κ"), (p0.kappa, "clip +κ")):
    ax.axvline(v, color=C["critical"] if v else C["axis"], lw=1, ls="--" if v else "-")
    ax.text(v, 1.72, lab, ha="center", fontsize=8, color=C["critical"] if v else C["ink2"])
ax.axvspan(-p0.s_floor, p0.s_floor, color=C["grid"], zorder=0)
ax.set_yticks([0, 1]); ax.set_yticklabels(["red-hot", "mega-cap"]); ax.set_ylim(-0.5, 1.9); ax.set_xlim(-1.6, 1.6)
ax.set_xlabel("realized ln(print) − dealer prior mid, log units (grey band = spread floor)")
ax.set_title("Where prints land relative to the prior (leave-one-out tier median, 45 prints, 14 names)", loc="left", fontsize=11, color=C["ink"])
ax.grid(False); ax.legend(frameon=False, fontsize=8.5, loc="upper right")
savefig(fig, "3_prior_calibration")

# 4. resolutions per quarter (binaries resolving YES across all names + listed only)
fig, ax = plt.subplots(figsize=(8, 3.4))
b = results[(12, "none")]["binaries"]
yes = b[b.outcome_yes].copy(); yes["q"] = pd.to_datetime(yes.quarter_end).dt.to_period("Q").astype(str)
qs = sorted(b.quarter_end.map(lambda d: pd.Timestamp(d).to_period("Q")).astype(str).unique())
listed_ct = yes[yes.company.isin(LISTED)].groupby("q").size().reindex(qs, fill_value=0)
analog_ct = yes[~yes.company.isin(LISTED)].groupby("q").size().reindex(qs, fill_value=0)
x = np.arange(len(qs))
ax.bar(x, listed_ct, color=C["blue"], label="the five listed names", linewidth=0)
ax.bar(x, analog_ct, bottom=listed_ct + 0.0, color=C["orange"], label=f"{len(ANALOGS)} analog names", linewidth=0, edgecolor=C["surface"])
ax.set_xticks(x); ax.set_xticklabels(qs, rotation=0, fontsize=8); ax.set_ylabel("prints (binaries resolving YES)")
ax.set_title("How often the scoreboard moves: priced rounds per quarter", loc="left", fontsize=11, color=C["ink"])
ax.legend(frameon=False, fontsize=9)
savefig(fig, "4_resolutions_per_quarter")

json.dump({"bound_fwd": bound_fwd, "bound_bin_uniform": bound_bin_uniform, "bound_bin_floor": bound_bin_floor,
           "listed": LISTED, "analogs": ANALOGS}, open(f"{OUT}/meta.json", "w"), indent=1)
print("\nbounds: fwd", bound_fwd, "bin uniform", round(bound_bin_uniform), "bin floor", round(bound_bin_floor))

# ---------------------------------------------------------------- params.json: every number the app's model reads
# src/lib/config/dealer.ts imports this file; tests/config/dealer-params.test.ts
# fails if it is stale against these inputs, and backtest.yml fails if a rerun
# does not reproduce it byte for byte.
def sha256_of(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

if os.path.abspath(EVENTS) == os.path.abspath(f"{HERE}/events.csv"):
    cal = results[(12, "none")]["settlements"]; cal = cal[~cal.voided]
    sigma_tier = {t: float(cal[cal.tier == t].prior_err.std()) for t in ("mega", "redhot")}
    loo = results[(12, "none")]["loo_prior"]
    params = {
        "inputs_sha256": {name: sha256_of(f"{HERE}/{name}") for name in ("events.csv", "sim.py", "analyze.py")},
        "data_through": DATA_THROUGH.isoformat(),
        "tier": {"mega_threshold_usd": p0.mega_threshold},
        "prior": {
            "mu_stepup": {c: {t: loo[(c, t)] for t in ("mega", "redhot")} for c in LISTED},
            "mu_stepup_fallback": p0.mu_stepup,
            "cadence_months": p0.cadence_months,
            "weibull_k": p0.weibull_k,
            "days_per_month": p0.days_per_month,
            "leak_hazard_near": p0.leak_hazard_60d,
            "leak_hazard_far": p0.leak_hazard_far,
            "leak_window_days": p0.leak_window_days,
        },
        "sigma_tier": sigma_tier,
        "dealer": {
            "kappa": p0.kappa, "cap_usd": p0.Q, "b_usd": p0.b, "s_floor": p0.s_floor,
            "gamma": p0.gamma, "p_floor": p0.p_floor,
            "flag_spread_mult": p0.flag_spread_mult, "flag_cap_mult": p0.flag_q_mult,
            "flag_hours": p0.flag_days * 24,
        },
        "forward_t_days": FORWARD_T_DAYS,
        # Contract terms the simulation assumed; the rulebook must state the same.
        "contract": {"binary_min_days": MIN_BINARY_DAYS},
    }
    with open(f"{OUT}/params.json", "w") as f:
        json.dump(params, f, indent=1, sort_keys=True)
        f.write("\n")
    print("params.json written")
