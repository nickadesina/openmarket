# Dispatch: onboarding, legible scoring, demo markets

Status (2026-10-22): O1 merged (#30). O2 stage 1 merged (#29); the
scoring rule is unchanged and there is no decision 0006. O3 has not
started: there is no `015_demo_accounts`, no `seed:demo`, no decision
0005. Move this folder to `docs/archive/prompts/` once O3 lands or is
dropped.

Three briefs for three cloud agents, from Nick's ask on 2026-10-22:

> We need a proper onboarding process. Sign-in page → (if signed in) put
> in affiliation (not required) → straight to the questions. The
> settlement logic is not intuitive. Seed the five markets with paper
> activity from about five seeded accounts, just to show how the product
> should work. The contracts as they exist are for show now; the real
> party is in the tournament.

Each brief stands alone. Every agent reads `AGENTS.md`, `PRODUCT.md`,
`DESIGN.md` and its own brief before writing code. Read `README.md` §2
and `CONTRACTS.md` too if you touch anything dealer-side.

| Brief | What | Branch |
| --- | --- | --- |
| `o1-onboarding.md` | Sign-in → affiliation → questions; the tournament becomes the front door | `ob/o1-onboarding` |
| `o2-scoring-legibility.md` | Make settling and scoring intuitive: plain words and live numbers first, a new scoring rule (decision 0006) if that is not enough | `ob/o2-scoring` |
| `o3-demo-markets.md` | Five labelled demo accounts trade the five listed names through the real services | `ob/o3-demo-markets` |

## Order

All three run in parallel from `master`, and each opens its own PR to
`master`.

- **File ownership is disjoint.** A brief's "Not yours" list is a hard
  boundary. A change another brief must make goes in your PR description
  under "Needs from O*"; never make it in their files.
- **Migrations:** only O3 adds one (`015_demo_accounts`). O1 and O2 add
  none. If you think you need one, stop and say so in the PR.
- **Merging (Nick's standing instruction):** merge your own PR to `master`
  once your gates pass. Don't wait on the others.
  - If `master` moved while you worked, merge `master` into your branch,
    re-run the gates, then merge.
  - A merge to `master` deploys to production. The Vercel build migrates,
    runs `seed:tournament -- --open`, and runs `verify:replay` (O3 adds
    `seed:demo`), so a red gate is a broken deploy.

## Every agent

- **Gates before merging:** `npm run check`, `npm run test:unit`, and
  `npm run test:integration` against a local Postgres
  (`DATABASE_URL_TEST`). Run the browser specs you touch, with `CI`
  unset. Chromium may need an `executablePath` override in a scratch
  config outside the repo; never run `playwright install`.
- **Real data only,** except O3's demo accounts under decision 0005. Never
  invent copy, figures or rows. Every number on a screen comes from the
  API.
- **Scoring:** O2 owns making scoring intuitive. It may change the scoring
  rule itself, recorded as decision 0006, under the constraints in its
  brief. O1 and O3 never touch scoring.
- **Delete what your change makes dead.**
- **Screens:**
  - Desktop and 375px both matter.
  - WCAG 2.2 AA (`PRODUCT.md`).
  - `DESIGN.md`'s named rules bind: Real Density, One Plate, Fixed Ramp,
    Red Interface / Green Movement, Price Precision, Caps Voice, 2.25rem
    controls.
  - Put before/after screenshots in the PR.
