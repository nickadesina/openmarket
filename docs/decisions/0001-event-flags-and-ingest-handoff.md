# 0001 — `event_flags` shape and the ingest hand-off

Date: 2026-10-21. Status: agreed between the dealer implementer and
the ingest owner. Supplements `TECHNICAL_DESIGN.md` §3–§4; where this
file is more specific, it wins.

## Ownership

- **Dealer implementer** owns the migration `007_dealer`, including
  the `event_flags` table, and milestones 1–3 and 5–8.
- **Ingest owner** owns milestone 4 in full: `/api/cron/ingest`,
  `ingest.yml`, the extractor behind
  `src/lib/services/ingest/extract.ts`, the admin confirmation queue
  for sub-high-confidence releases, per-source last-success, the
  silent-source alert and the "print with no preceding scoop" counter.
- Until ingest lands, every settlement, state-machine and mid-model
  test reads `tests/fixtures/event-flags.json` (below). No test
  invents a flag.

## `event_flags` — pinned

| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid | generated |
| `company_id` | fk companies | required |
| `kind` | enum | `form_d` · `form_d_amend` · `charter` · `scoop` · `release` · `s1_public` · `print` · `user_submitted`. Closed; adding a value is a migration |
| `source_url` | text | required for `print`; nullable otherwise (fixtures carry null) |
| `source_rank` | smallint | required for `print` (1–4 per `CONTRACTS.md`); nullable otherwise |
| `observed_at` | timestamptz | required — when the job saw it |
| `published_at` | timestamptz | nullable — the source's own time |
| `terms_json` | jsonb | fixed shape: `{amount_usd?, valuation_usd?, valuation_basis: "pre"\|"post"\|"unknown", lead?, pps_usd?, outlet?, quote?}`. Only `valuation_usd` and `valuation_basis` are load-bearing downstream |
| `confidence` | enum | `high` · `medium` · `low` |
| `dedupe_key` | text | **indexed, not unique**: syndications of one report share a key; the rulebook counts distinct `terms_json.outlet` within a key |
| `promoted_from` | fk event_flags | `print` rows only: the `release`/`s1_public` flag promoted; null for admin-created prints |
| `run_id` | fk cron_runs | nullable (null for fixtures and admin rows) |
| `submitted_by` | fk tournament_users | `user_submitted` rows only: the forecaster who filed the evidence (`011`) |
| `submitted_kind` | text | `user_submitted` rows only: the kind the submitter claims (`011`) |
| `created_at` | timestamptz | generated |

Append-only via the same trigger the tournament uses. No `updated_at`.
A correction is a new row; `promoted_from` and `dedupe_key` are how
rows relate.

## Fixture

`tests/fixtures/event-flags.json` — 161 flags derived from
`backtest/events.csv`: 43 `scoop` (earliest Tier-1 "in talks" report
with its cited valuation, `valuation_basis: unknown`), 59 `release`
(closed terms, `basis: post`) and 59 `print` (the release promoted at
rank 1). `source_url` is null in the fixture on purpose; URLs live in
`backtest/data/*.csv` and are ingest's job to attach.

Regenerate (from the repo root, pandas installed):

```
python3 - <<'EOF'
import pandas as pd, json, hashlib
df = pd.read_csv("backtest/events.csv", parse_dates=["announcement_date","leak_date"])
pr = df[df.event_type=="priced_round"]
listed = {"OpenAI","Anthropic","Anduril","Modal","Instinct"}
slug = lambda c: c.lower().replace(" ","-")
key = lambda *p: hashlib.sha256("|".join(map(str,p)).encode()).hexdigest()[:16]
flags = []
for r in pr.itertuples():
    co = slug(r.company); L = r.company in listed
    if pd.notna(r.leak_date):
        v = None if pd.isna(r.leak_post_money_usd) else int(r.leak_post_money_usd)
        flags.append({"company_slug":co,"listed":L,"kind":"scoop","published_at":str(r.leak_date.date()),"observed_at":str(r.leak_date.date()),"source_rank":4,"source_url":None,
                      "terms":{"valuation_usd":v,"valuation_basis":"unknown" if v else None,"lead":r.lead if isinstance(r.lead,str) else None},
                      "confidence":"high","dedupe_key":key(co,"scoop",r.leak_date.date(),v),"note":r.notes if isinstance(r.notes,str) else None})
    pm = None if pd.isna(r.post_money_usd) else int(r.post_money_usd)
    amt = None if pd.isna(r.amount_raised_usd) else int(r.amount_raised_usd)
    rel = {"company_slug":co,"listed":L,"kind":"release","published_at":str(r.announcement_date.date()),"observed_at":str(r.announcement_date.date()),"source_rank":1,"source_url":None,
           "terms":{"amount_usd":amt,"valuation_usd":pm,"valuation_basis":"post" if pm else None,"lead":r.lead if isinstance(r.lead,str) else None},
           "confidence":"high","dedupe_key":key(co,"release",r.announcement_date.date(),pm),"round_name":r.round_name}
    flags.append(rel)
    if pm: flags.append({**rel,"kind":"print","promoted_from_dedupe_key":rel["dedupe_key"],"dedupe_key":key(co,"print",r.announcement_date.date(),pm)})
flags.sort(key=lambda f:(f["published_at"],f["company_slug"],f["kind"]))
json.dump({"generated_from":"backtest/events.csv","count":len(flags),"flags":flags}, open("tests/fixtures/event-flags.json","w"), indent=1)
EOF
```

## Alerts split

Milestone 8 ships the `instrument widened > 72 h` alert. The
silent-source alert and the no-scoop-before-print counter ship with
ingest. The admin page reads `source_health` against an empty table
until then, so ingest landing is a data change, not a UI change.

## What ingest promises the dealer

- A `scoop` on a Tier-1 RSS feed becomes a row within one 15-minute
  job run; the dealer job that follows widens within 30 minutes of
  publication.
- A `release` or `s1_public` with `confidence: high`, source rank 1–2,
  a `source_url` and a post-money is promoted to `print` by the settle
  job without human action; anything less waits for the admin queue
  (not built: `/admin/dealer` lists rank 3–4 as pending, read-only).
- Every row has a `run_id`; every run has a `cron_runs` row; nothing
  is written outside a run except admin-created prints and
  `user_submitted` flags.
