# Tradeables: ten things OpenMarket gives away to get a conversation

Date: 2026-10-26. Status: brief for agents. Owner: Nick.

## Why this exists

The farm-tier outreach list (about 75 researched people and 125 more
from bios) fails on one thing: every DM asks for twenty minutes and
offers nothing. This pass turns the ten things OpenMarket can offer
into artifacts that exist at a URL or in a file, so a DM can lead with
"here is X" instead of "can I have your time".

The ten, in the order a DM would use them:

| # | Tradeable | Who it opens | State today | Build |
| --- | --- | --- | --- | --- |
| 1 | Resolution-source map | investors, press, policy | `docs/tradeables/resolution-sources.json` and a rendered `.md`, written in this pass | a public page and the export script that regenerates the `.md` |
| 2 | Round-history dataset | investors, quants, academics | `public/data/round-history.{csv,json}`, generated once in this pass | the export script that reproduces them byte for byte |
| 3 | Backtest output | quants, academics, MMs | `public/data/backtest/*`, generated once in this pass | the export script and the redaction test |
| 4 | Rulebook v1, reviewable | lawyers, engineers, ops | `GET /api/ref/rulebook` (JSON); changelog, reviewers file and issue template written in this pass | a human page at `/rulebook` |
| 5 | Reference feed, free trial | anyone who shows a private mark | `/api/ref/*` and `npm run api-key:create` exist | a `/ref` docs page, a design-partner key tier, the trial terms |
| 6 | First-maker right of refusal | market makers, prop desks | nothing | a one-page offer, a slot register |
| 7 | Tournament question on request | forecasters, academics, data vendors | `/t/admin` drafts questions by hand | questions from a file, a proposer credit, a share link |
| 8 | Objection catalog | emerging managers, peers | nothing | a file with a fixed row shape, seeded |
| 9 | Distribution | junior investors, newsletters | the X account and the tracker repo | three post templates and a log |
| 10 | Case-study status | policy shops | nothing | a one-pager, public, with the contract definitions |

Items 6, 8, 9 and 10 are documents, not code; their first versions are
in `docs/tradeables/` from this pass. The data files under
`public/data/` were generated once by hand from the repo's own files
(the generation steps are described under each item); the scripts
this brief asks for must reproduce them exactly, which is the
acceptance test for items 1 to 3. Where a generated file and the
script disagree, the script is wrong until proven otherwise, because
the files were checked by eye.

## Rules for every agent

Read `AGENTS.md`, `README.md` section 2 and `CONTRACTS.md` first.
Everything here is public or will be sent to strangers, so the two
lines that matter most are these:

**What never leaves the repo.** `backtest/sim.py`, `backtest/analyze.py`,
`backtest/out/params.json`, `prior_golden.json`, `losses_T12.csv`,
`src/lib/engine/dealer/prior.ts`, `blend.ts`, and any number from them:
b, Q, κ, p_floor, s_floor, the flag multipliers, λ, k, μ step-ups,
σ_tier, the leak hazard constants, the blend weights. Also the market-
maker terms Nick will offer, which do not exist in writing and must not
be invented here. A public export that contains any of these is a bug.
Add a test that greps the public exports for the parameter names and
their values and fails on a hit.

**What is already public and can be given freely.** The rulebook
(`/api/ref/rulebook`), the model mids (`/api/ref/[slug]/mids`, README
D14: public and unredacted), the reference price and its versions, the
contract definitions in `CONTRACTS.md`, `events.csv` and the source
URLs, the calibration errors (how far the prior was from each print)
and the void and resolution counts.

**Real data only** (AGENTS.md). Every row in a public export derives
from a file in the repo. Nothing is typed in by hand to look fuller.

**Gates.** `npm run check`, `npm run test:unit`, and
`npm run test:integration` where a route or script touches the
database. A new public page follows `DESIGN.md` and `PRODUCT.md`
(institutional, restrained, no cards for every datum).

**Branches.** One PR per numbered item, branch `tr/<n>-<slug>`. Items
1, 2, 3 and 4 can run in parallel from `master`. Item 5 after 4. Items
7 and 10 after 1. The document items (6, 8, 9) have no code
dependency.

**Voice.** Plain declarative sentences. No em-dashes anywhere, in
pages, exports or docs. No hype words. The reader is a stranger who
trades or regulates for a living.

---

## 1. Resolution-source map

The single most-used offer: about twenty rows on the pipeline send it.
A one-page comparison of how each venue that prices private companies
settles, and where OpenMarket sits.

**Source of truth.** `docs/tradeables/resolution-sources.json`, written
in this pass from the Oct 26 research. Each entry:

```
{
  "venue": "Polymarket",
  "product": "IPO-timing and valuation-threshold event contracts on OpenAI, Anthropic, Stripe, Databricks, Kraken",
  "launched": "2026-05-19",
  "instrument": "binary",
  "settlement_source": "Nasdaq Private Market data",
  "source_published": true,
  "revision_window": null,
  "void_rule": null,
  "status": "live",
  "notes": "...",
  "sources": ["https://..."],
  "verified": "2026-10-26",
  "needs_check": false
}
```

Keep the field set exactly this. `needs_check: true` marks a row Nick
has not confirmed; the page shows those rows with an "unverified" mark
and the export carries the flag. Do not fill a null with a guess.

**Build.**

- `src/app/resolution-sources/page.tsx`: a server-rendered page,
  one table, columns venue, product, instrument, settlement source,
  published, revision window, void rule, status. OpenMarket's row is
  computed from `RULEBOOK` (`src/lib/engine/dealer/rulebook.ts`), never
  typed into the JSON, so the page can never disagree with the code.
  Footer: `rulebook_version`, the JSON file's `as_of`, and a link to
  the markdown export. Noindex is fine; the page is for sending, not
  for search.
- `scripts/export-resolution-sources.ts`: writes
  `public/resolution-sources.md` from the same JSON plus the computed
  OpenMarket row, with a sources list at the end. `npm run
  export:tradeables` runs every export in this brief.
- A unit test that parses the JSON against a zod schema and fails on a
  row with `needs_check: false` and no source URL, or with `verified`
  null.

**Acceptance.** `/resolution-sources` renders with the OpenMarket row
taken from the rulebook; the markdown export opens in a text editor and
reads top to bottom without the page; every row with `needs_check:
false` has a source URL that resolved on the verification date.

---

## 2. Round-history dataset

What the hazard model was fit on, as a clean public CSV. It is public
press data; the value is that someone joined and dated it.

**Build.**

- `scripts/export-round-history.ts`: joins `backtest/events.csv`,
  `backtest/data/sources.csv` (source URL, rank, publisher) and the
  tier at the time of the print (listing rule in README D10: mega-cap
  at or above $10B last print, red-hot below). Output
  `public/data/round-history.csv` with columns:
  `company, event_type, round_name, announcement_date, post_money_usd,
  amount_raised_usd, lead, tier_at_print, source_url, source_rank,
  publisher, leak_date, leak_post_money_usd, notes`.
  Rows with `event_type = tender_or_secondary` stay in, flagged, because
  "not a print" is part of the lesson. Rows without a source URL keep
  an empty `source_url` and `source_rank`; never invent one.
- A sidecar `public/data/round-history.json` with the same rows plus a
  header: `{"as_of": "<events.csv data_through>", "rows": N,
  "events_sha256": "<digest>", "rulebook_version": "...",
  "license": "CC BY 4.0, cite OpenMarket"}`. The digest is
  `params.json`'s `inputs_sha256["events.csv"]`, read from the file,
  so a stale export is visible.
- Serve both at `/data/round-history.csv` and `.json` (static files
  under `public/`). Link them from `/resolution-sources` and from the
  `/ref` docs page (item 5).
- `README.md` drift register row: "events.csv has 56 priced rounds"
  already says 59 rows total; the export header reports the real count.

**Excluded on purpose.** `mu_stepup`, `cadence_months`, every column
of `calibration.csv` except what item 3 publishes, and `analogs.csv`'s
role as the leave-one-out set (the analogs' rows are in `events.csv`
and ship; the fact that they seed the prior does not).

**How the committed file was made.** Rows of `events.csv` joined to
`sources.csv` on (company, round_name); `tier_at_print` is the tier
set by the company's previous priced round (empty for a first round);
sorted by company then date. 64 rows, 59 priced rounds, 20 with a
source URL. Instinct's Seed is the one listed-name print without a
source (known; `docs/ARTIFACTS.md`).

**Acceptance.** `npm run export:tradeables` reproduces
`public/data/round-history.csv` and `.json` byte for byte; the CSV
opens in a spreadsheet with no quoting breakage; the grep test in the
rules above passes.

---

## 3. Backtest output, redacted

What quants and academics want: how far the prior was from each print
and what the contracts would have done, without the construction.

**Build.**

- `scripts/export-backtest-public.ts` writes `public/data/backtest/`:
  - `calibration.csv`: from `backtest/out/calibration.csv`, columns
    `company, tier, listed, expiry, print_date, voided, prior_err`
    only. Drop `mid0`, `ln_last`, `ln_print`, `loss_fwd`, `pred`,
    `real` (they reconstruct the step-up).
  - `resolutions.csv`: per name and quarter, whether the binary
    resolved YES, from `tests/fixtures/rulebook-events.json` (it already
    lists each listed name's forward lives and binary quarters).
  - `void-rates.csv`: per name, lives, settled, voided, at the launch T
    and at T = 3 and 12 months, from `summary.csv` and
    `rulebook-events.json`. Lives and counts only, never the dollar
    losses (they imply Q and b).
  - `README.md` in that folder: what each file is, the one-paragraph
    reading from `backtest/RESULTS.md` with every dollar figure and
    parameter removed, the `data_through` date, and the sentence "The
    construction of the prior is not published."
- The redaction is a test, not a convention: `tests/scripts/
  export-backtest-public.test.ts` asserts the output files contain
  none of the parameter names or values from `params.json` and none of
  the dropped column names.

**How the committed files were made.** `calibration.csv` keeps the
seven columns named above. `resolutions.csv` and `void-rates.csv` come
from `tests/fixtures/rulebook-events.json` → `listed` (each name's
`binary_event`, `forward_t_days`, forward lives by status, binaries by
status). `void-rates-uniform-t.csv` takes the `at_listing` scenario's
`listed` rows for T = 3 and 12 from `summary.csv` (lives = settlements
+ voids; the loss columns dropped). The redaction check that was run by
hand greps every file under `public/data/` for the parameter names in
`params.json` and for every non-trivial numeric value under its
`prior` and `dealer` keys; it found nothing. Make that the test.

**Acceptance.** `npm run export:tradeables` reproduces the four files
and the README; an outsider can compute σ by tier from
`calibration.csv` and reproduce the void-rate chart, and cannot
compute the step-up, the hazard or the dealer's bound.

---

## 4. Rulebook v1, reviewable

The rulebook is code and JSON. Reviewers need a page they can read and
a place their name goes.

**Build.**

- `src/app/rulebook/page.tsx`: renders `RULEBOOK` as prose sections in
  the order of `CONTRACTS.md` → Definitions: print, announcement,
  source ranks with the Tier-1 outlet list, syndication, revision
  window and grace, the binary's rules, the forward's rules. Every
  section heading carries an anchor so a reviewer can link to one
  rule. Header: version, `model_version` from the envelope, and the
  line "Rules marked not built are the contract's intent; the code
  does not enforce them yet" with those rules marked from a small
  `NOT_BUILT` list kept beside `RULEBOOK` (charter re-centring, rank
  3–4 review queue, correcting settlement; README drift register).
- `docs/RULEBOOK_CHANGELOG.md` (written; v1.0.0 is the first entry),
  `docs/RULEBOOK_REVIEWERS.md` (written; empty table) and
  `.github/ISSUE_TEMPLATE/rulebook-review.md` (written). The page
  renders the reviewers table under "Reviewed by" and links the
  changelog. Reviewers who are not on GitHub send the template's three
  lines by DM and Nick files the issue.

**Acceptance.** `/rulebook` and `/api/ref/rulebook` carry the same
version string, by construction (both read `RULEBOOK_VERSION`); the
page has no text that is not in `RULEBOOK` or the two markdown files.

---

## 5. Reference feed, free trial

The offer to Freeport, Liquid, FalconX, Tap, Adjacent, Furnace and fund
administrators: the five names' reference price, versioned, free,
design-partner status. The API exists (README D14). What is missing is
a page a stranger can read, a key tier that says what it is, and the
terms.

**Build.**

- `src/app/ref/page.tsx`: API docs. Each route with a real response
  taken from the running service at build time is not possible
  (static page), so render the response shapes from the TypeScript
  types (`RefHistoryPayload`, `RefListing`, the envelope) and one
  example payload captured into `docs/tradeables/ref-examples.json`
  by a script that hits a local dev server (`npm run
  export:ref-examples`, needs `DATABASE_URL`). Sections: the
  envelope and what each version means, the five routes, the public
  quota (60/min per network) and the keyed tier, the blend in one
  paragraph (model mid, 30-day traded price, tournament crowd, weights
  on a published schedule; with no flow and no crowd the reference is
  the model mid and says so), how to cite a price (`slug`, `as_of`,
  the three versions).
- Key tiers. `api_keys` gets a `tier` column (migration, append-only):
  `design_partner` (quota 600, free, expires 365 days from creation,
  `expires_at` column) and `standard`. `npm run api-key:create --
  --name=<desk> --tier=design_partner` prints the key once and the
  expiry. `ref-access.ts` refuses an expired key with 401 and a
  message naming the expiry. `/admin/dealer` lists keys by tier with
  request counts for the last 7 days (no key material).
- `docs/tradeables/feed-trial.md` (written): the terms, one page: what the partner gets (five names, both contracts, 60 s
  cache, 600/min, a key the same day), what they agree to (cite
  OpenMarket and the versions when the price appears anywhere,
  tell Nick within a week if a price looks wrong, one call a quarter
  on what they do with it), what it is not (not a representation of
  value, not advice, may be withdrawn with 30 days' notice). Served
  at `/ref/trial` as a page rendered from the markdown.

**Acceptance.** A new partner goes from DM to a working key in one
command and one message; the key stops working on its expiry date
with a clear error; the `/ref` page is enough to integrate without
reading the repo.

---

## 6. First-maker right of refusal

A document. A capped book with a published mid is bounded risk, which
is a product for a market maker. The offer is the slot, never the
terms.

**Build.**

- `docs/tradeables/maker-slot.md` (written): what a slot
  is (first right to quote as a second dealer on the five names when
  the real-money venue opens, on the public rulebook, with the
  position cap published at that time), what the maker sees now (the
  rulebook, the reference feed, the backtest's public outputs, the
  paper books at `/m`), what they do not see (the mid construction, b,
  Q, κ, the blend weights, any other maker's terms), what accepting
  means (nothing binding; a named slot in a register and first look
  at terms when they exist), and that slots are dated and expire if
  the venue has not opened in twelve months.
- `docs/tradeables/maker-register.md` (written, empty): desk,
  contact, slot date, status. Private repo, so names are fine; no
  terms in the file ever.

**Acceptance.** Nick can send `maker-slot.md` to Auros, CMT, Galaxy,
Rob Levy or Monaco without editing it and without a lawyer, because it
promises nothing but a dated place in line.

---

## 7. Tournament question on request

The tournament can ask a question on someone's topic (FutureSearch's
agents on the five names, a Castle Island episode's question, a
Moallemi test case). Today questions are drafted by hand in `/t/admin`
or by `seed:tournament` from a hard-coded launch list.

**Build.**

- `scripts/seed-tournament.ts` takes `--from=<path>`: a JSON array of
  `questionInputSchema` inputs (the same validation the admin route
  uses). `docs/tradeables/questions/` holds one file per proposer,
  for example `futuresearch.json`. Questions still follow decision
  0004: a binary or a forward on a listed name, nothing else. A
  proposer cannot change that; the file format refuses other kinds.
- `tournament_questions` gets `proposed_by` (text, nullable,
  migration append-only): the proposer's name as they want it shown.
  The question page shows "Proposed by <name>" under the title when
  set. Admin can set it on a draft through the existing notes route
  or a new field on `POST /api/t/admin/questions`.
- A share link per question already exists (`/t/q/[slug]`); add
  Open Graph title and description to that page (question title,
  close date, "log-scored forecasting tournament") so the link
  unfurls on X. No image generation.
- Export: `GET /api/t/questions/[slug]/forecasts` is public; document
  in `/ref` that a proposer can pull the forecast log and aggregate
  history for their question, which is the data vendor offer to
  FutureSearch.

**Acceptance.** A question file goes from a proposer's DM to an open
question with their name on it in one command; the forecast log for
it is pullable without a key.

---

## 8. Objection catalog

What people on the pipeline said, in a fixed shape, so the catalog
can be sent to an emerging manager or used to tighten the pitch. It
is deal intel for them and a memory for Nick.

**Build.**

- `docs/tradeables/objections.md` (written, eight rows) with what is
  already on record (the Pantera president, Jay Yu's three written
  objections, dingaling on AMMs, the Speedrun alpha no). One table,
  columns: date, who (role and firm, no name unless public),
  objection in their words, which design element it hits (settlement,
  SBS classification, two-sided depth, why you, mechanism, rails,
  team), Nick's current answer in one line, status (open, answered,
  conceded). Conceded means the design changed; link the decision.
- An export view for sending: `scripts/export-objections.ts` writes
  `docs/tradeables/objections-anon.md` with the who column reduced to
  the role and firm type ("partner, crypto fund") and the answer
  column dropped. That is the file that leaves the repo.

**Acceptance.** Every call on the pipeline adds at least one row
within a day; the anonymized export never contains a name or a firm.

---

## 9. Distribution

The X account can feature a piece. This is a process with templates,
logged so it is not forgotten.

**Build.**

- `docs/tradeables/distribution.md` (written): the three
  post shapes that fit the account's rules (originals, not quotes;
  the 2–4 h ride window only when the source escaped; a specific
  line, not a generic one) and the log table: date, handle, piece,
  post link, views at 24 h.
- No code in this repo. The tracker lives in `nickadesina/
  twitter-checker`; a `featured` tag there is that repo's concern.

**Acceptance.** Every "I'll post about your piece" promise on the
pipeline has a row with a post link within a week.

---

## 10. Case-study status

Policy shops (HPC, CCI, DEF, Variant's policy writers) want a live
example of a US founder building the S-1-window product their letters
describe. The artifact is a public one-pager that cites the contract
definitions and nothing proprietary.

**Build.**

- `docs/tradeables/case-study.md` (written): who (Nick,
  real name, SF), what (two contracts per name, defined by quoting
  `CONTRACTS.md` → Definitions and the binary's "public S-1 filed"
  event for the labs), the rulebook (link to `/rulebook` and the
  version), the path (paper and tournament now; a real-money venue
  offshore and US-geofenced as the bootstrap; a CFTC DCM listing as the
  business), the question the founder cannot answer alone (whether a
  cash-settled forward on a private company's next post-money is a
  security-based swap or a commodity forward), and what the founder
  will do for a letter (be named, supply the round-history dataset
  and the mark-dispersion figures, co-sign).
- `src/app/for-policy/page.tsx`: the same markdown rendered, with the
  rulebook version and the data links filled from the repo, so the
  page never cites a version that is not live.

**Acceptance.** A policy counsel can lift one paragraph from the page
into a comment letter with a URL that resolves, and nothing on the
page needs Nick's review before it is quoted.

---

## Decided (Nick, 2026-10-26)

1. The pages live on openmarket.systems, same app, same deploy,
   noindex.
2. Datasets carry "CC BY 4.0, cite OpenMarket".
3. The design-partner key expires 365 days from creation.
4. The forward's launch T values are published; they are contract
   terms.

## Research scripts agents can build

Three of the offers on the pipeline depend on data nobody has pulled.
The pulling is code; the reading of it is not. Build the scripts under
`scripts/research/`, outputs under `docs/research/` (private; nothing
here is published until Nick reads it). Each script is idempotent,
records its fetch time, and writes CSV plus a short `README.md` saying
what it pulled and from where. None of these touch the app's database.

- `polymarket-private-markets.ts`: pull every Polymarket market whose
  question names OpenAI, Anthropic, Stripe, Databricks, Kraken, SpaceX
  or xAI from the public Gamma and CLOB APIs (market, question,
  resolution source text, open and close dates, outcome, resolution
  date, volume, last prices before close). Output
  `docs/research/polymarket-private-markets.csv`. This is the raw
  material for the resolution-quality read offered to General
  Catalyst, Castle Island, Predicted and Polymarket's liquidity team.
- `edgar-nport-marks.ts`: EDGAR full-text search for N-PORT filings
  that hold "Anthropic", "OpenAI", "Anduril" or "Modal" (Fidelity,
  T. Rowe, BlackRock and similar mark private names quarterly), then
  parse each holding's reported value and shares into a per-fund,
  per-quarter mark. Output `docs/research/fund-marks.csv`. This is
  the mark-dispersion figure the case study and the Alana Levin note
  promise. Respect SEC's rate limits and user-agent rule.
- `uniform-loss-vs-lmsr.py` in `backtest/`: implement the uniform-loss
  pricing function from Moallemi, Robinson and Zhu (arXiv 2607.17428,
  with the pm-AMM note, Nov 2024) beside the existing two-outcome LMSR
  in `sim.py`, run both against `events.csv` under the `at_listing`
  and `at_leak` scenarios with the same loss budget per binary
  quarter, and write `backtest/out/uniform_loss_comparison.csv`. Do
  not change `params.json` or any published parameter; this is a
  comparison, not a rerun. The result is the offer to Moallemi, and
  what he sees is the comparison table, never `sim.py`.
- `docs/tradeables/questions/futuresearch.json`: four questions (the
  five names' binaries and forwards for the next quarter, as decision
  0004 shapes them) ready for `seed:tournament --from`, with
  `proposed_by` left for Nick to fill after FutureSearch says yes.

## Research backlog (not for agents)

Work that needs the web, a phone call or Nick's judgment. Listed so it
is not lost; none of it blocks the code.

1. Confirm the six unverified rows in `resolution-sources.json`: how
   Soar, Pascal and trade.xyz settle for real money, Entropy's
   settlement rule and a URL for it, Freeport's pricing source, and
   that Kalshi lists nothing on private names. Soar and Pascal are
   DMs on the pipeline; asking is the play.
2. Source URLs for the 39 priced rounds in `events.csv` that have
   none (the analogs and the listed names' older rounds), and
   Instinct's Seed. Mechanical, web-only.
3. Read `polymarket-private-markets.csv` once it exists and write the
   resolution-quality note: which markets resolved, on what, whether
   the Nasdaq Private Market figure matched a later print. That note
   is the thing sent to GC, Castle Island, Predicted and Polymarket.
4. Read `fund-marks.csv` and write the two-paragraph mark-dispersion
   figure for `case-study.md` and the Alana Levin note.
5. Handle and identity checks before DMing: whether @bcap is
   Blockchain Capital or Bain Capital Crypto (Jonah, Maddiaa), Jed
   Breed's personal handle, that @Nostroah, @rexsalisbury and
   @aaronmillerwv resolve, @yenwod_ as Matthew Downey, Max Tang's
   seat at Auros, Mitchell's at MetaDAO, Lastnamelove's at Franklin,
   Jakub's at Colosseum.
6. Kalshi Research: the conference date and abstract deadline, which
   no public page states.
7. After the first five customer calls (Freeport, Liquid, FalconX,
   Tap, Adjacent or Furnace): the customer-discovery memo promised to
   Matthew Nay and Jed Breed.
8. The objection catalog fills from calls, one row each, within a
   day.

## Done when

`npm run export:tradeables` writes every export; the four pages render;
the grep test for parameters passes on everything under `public/`; the
seven documents in `docs/tradeables/` exist and `docs/ARTIFACTS.md`
lists them; and the pipeline's "What I bring" lines can each point at
a URL or a file.
