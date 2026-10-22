# Brief O1: onboarding, and the tournament as the front door

Repository `nickadesina/openmarket`. Branch `ob/o1-onboarding` from
`master`; PR to `master`, merged by you once the gates pass. Read
`AGENTS.md`, `PRODUCT.md`, `DESIGN.md` and
`docs/prompts/onboarding-and-demo/README.md` first. Read the Next.js
guides under `node_modules/next/dist/docs/` before writing route code.

## The goal

A new visitor should go: **sign in → (optional) affiliation → the
questions**, in under a minute, with nothing else in the way. Today it
does not:

- `/` is the dealer markets board, but the tournament is the product now;
  the markets are a demo (O3).
- Signing in with X lands on the forecaster's own profile, via
  `src/app/api/t/auth/x/callback/route.ts`, which redirects to
  `/t/u/<handle>`.
- Username/password sign-in returns to `?return=` or wherever the page
  defaults.
- Affiliation can only be set from the profile page, through
  `tournament-forecaster/affiliation-editor.tsx` inside
  `forecaster-page.tsx`, so nobody finds it.

## Yours (only these)

- `src/components/tournament-signin/**` and `src/app/t/signin/**`
- A new `src/app/t/welcome/**` route and its component folder (e.g.
  `src/components/tournament-welcome/**`)
- `src/app/api/t/auth/**`, the sign-in and registration redirects only
- `src/lib/services/tournament/sign-in.ts`, only to report whether an
  identity was just created
- `src/lib/auth/return-path.ts`
- `src/app/page.tsx`, a new `src/app/m/page.tsx`, and
  `src/components/app-shell/**` (site nav and entry)
- `src/components/tournament-nav/**`
- `src/components/tournament-forecaster/affiliation-editor.tsx`, so it
  can be reused on the welcome step; keep it working on the profile page
- `tests/browser/account.spec.ts` and a new `tests/browser/onboarding.spec.ts`

**Not yours:**
- `tournament-question/**`, `tournament-board/**` and the tournament parts
  of `format.ts`. These are O2's.
- Everything under `market-*`, `home-*`, `trade-ticket`, `portfolio` and
  the dealer services. These are O3's.
- Migrations, which only O3 adds.
- Scoring.

## Do

1. **Front door.**
   - `/` becomes the tournament: redirect to `/t`, or render the board.
     Pick one and say which in the PR.
   - The markets board moves to `/m`. `/m/[slug]` already exists, so the
     board's index joins it.
   - The site nav reads Tournament first, then Markets and Portfolio.
   - Every internal link to `/` that meant the markets board points to
     `/m`. Search for them; O3 owns the market components, so list any
     link inside their files under "Needs from O3".
2. **Sign-in page** (`/t/signin`).
   - One clear primary action, "Continue with X", plus the
     username/password form as the secondary path. Copy is short.
   - It must read as a modern product, not a form dump: the same type
     ramp and red, generous spacing, and one sentence on what the
     tournament is (taken from existing copy on `/t`; nothing invented).
3. **After sign-in, the first time only.**
   - A newly created identity goes to `/t/welcome`. This covers both X
     (callback) and password register.
   - "First time" means `upsertIdentity` created the identity in this
     call; return that flag. Do not add a column for it.
   - A returning sign-in goes to its `return` path, or `/t`.
4. **`/t/welcome`.**
   - One step: "Affiliation (optional)" (lab, school, firm), using the
     existing affiliation editor and endpoint `/api/t/me/affiliation`.
   - Two actions: Save and continue, and Skip. Both land on `/t`, the
     questions.
   - Say once, plainly, that forecasts are public under the forecaster's
     name. The editor already shows this on the first submission, so
     don't duplicate it there.
   - Signed out → redirect to `/t/signin?return=/t/welcome`.
5. **Signed-out visitors on `/t` and on a question** see a single "Sign in
   to forecast" call to action where the editor would be. It returns them
   to that question after sign-in, through the welcome step if new.
6. Keep `safeReturnPath` strict: same-origin paths only.

## Tests

- `onboarding.spec.ts`:
  - new password account → welcome → skip → `/t` lists the open
    questions;
  - new account → welcome → save an affiliation → it shows on the profile;
  - returning sign-in → straight to the `return` path;
  - `/` → the tournament, and `/m` → the markets board.
- Update `account.spec.ts` for the new landing.
- Integration: `upsertIdentity` reports created vs existing.

## Done

PR merged to `master` with gates green, and screenshots of sign-in,
welcome and `/t` at desktop and 375px.
