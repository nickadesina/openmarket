# C4 — Markets UI, read APIs, trading routes, comments

Read `docs/prompts/cleanup/README.md`, `AGENTS.md`, `PRODUCT.md`,
`DESIGN.md` (its named rules bind), `PART3.md` and `PART4.md` first.

The paper markets (`/m`, `/m/[slug]`, `/portfolio`, `/admin`) sit
beside the tournament on the same sign-in. This pass has three goals:
- stop the screens throwing away good data or crashing on cache
  races;
- send every figure through `format.ts`;
- make the shared request and response layer consistent.

No screen should look different except where an item fixes a missing
state. Put before/after screenshots at desktop and 375px in the PR.

## Yours

- `src/app/{page.tsx,layout.tsx,globals.css}`, `src/app/{m,portfolio,admin}/**`
- `src/app/api/{markets,activity,portfolio,quote,trade}/**`, `src/app/api/admin/comments/**`
- `src/components/**` except `tournament-*` (C3) and `admin-dealer` (C2's data; restyle only if an item says so)
- `src/lib/client/{api,format,query-keys,use-trade-execution}.ts`
  (shared: others may add)
- `src/lib/api/**` except `ref-route.ts` (C2)
- `src/lib/services/{list-markets,get-market,get-marks,get-activity,downsample-marks,portfolio,user,create-comment,list-comments,remove-comment,rate-limit}.ts`
- `src/lib/security/**`, `src/lib/logging/**`, `src/styles/**`
- Tests that touch the above: `tests/routes/{read-routes,write-routes}*`,
  `tests/api/*` except `api-key`, `x-oauth`, `return-path` and
  `tournament-password`;
  `tests/services/{get-activity,get-marks,downsample-marks,portfolio,user,rate-limit}*`;
  `tests/integration/{part3,listing-read,comments}.test.ts`;
  `tests/browser/dealer.spec.ts`

## Not yours

Dealer services and jobs (C2), tournament anything (C3), the engine
(C1), scripts and CI (C5).

## Items (most important first)

1. **The portfolio can crash right after sign-in.** Four observers
   share `queryKeys.portfolio` with different query functions:
   `home-stats`, `tournament-account`, `portfolio-page` and
   `market-comments`.
   - Some return `null` on `USER_REQUIRED`; the others throw.
   - `portfolio-page.tsx` reads `identity.userId` from a cache entry
     that can hold `null`.

   To reproduce: sign in with the header's dev sign-in, which
   invalidates without a reload, then open `/portfolio`. Give identity
   its own key and one query function, and guard the page. Add a
   browser or component test that reproduces the crash first.

2. **The board and activity vanish on one failed poll.**
   `market-board.tsx` and `home-activity.tsx` branch on `isError` even
   when data exists, so a single failed 4 s poll replaces the prices.
   The board's own copy says it doesn't. Follow `home-stats.tsx`:
   `isError && data === undefined` for the error state, and a quiet
   stale note otherwise. Sweep every `useQuery` consumer under
   `src/components` for the same pattern.

3. **`HomeDistribution` has no states.** It returns `null` on loading,
   error and empty (`home-distribution.tsx`). `PRODUCT.md` and `PART4.md`
   require layout-matched loading, retryable error and empty states.
   Build them from the existing skeleton and error primitives, then
   delete the "known gaps" note in `PART4.md`.

4. **The binary spend input is not canonicalised.**
   `binary-ticket.tsx` sends the raw `type=number` text as
   `spend_usd`. "1e2" and "10.555" pass `validAmount`, then the server
   rejects them as "Request body is invalid." Validate and format
   exactly as the forward ticket does (`NOTIONAL_PATTERN`, `toFixed`).

5. **One slippage helper.**
   - The buy guard is `Math.ceil(engine_cost_usd*1.01*100)`, on a float.
   - The sell guard is `Math.floor(cents*0.99)`, written in both
     `binary-ticket.tsx` and `portfolio-page.tsx`.
   - `strike_index: 0` is also duplicated in both files.

   Move the guards into one helper in `use-trade-execution.ts` (or
   `format.ts`) and do the arithmetic in integer cents. Unit-test the
   boundaries.

6. **Broken link.** The portfolio's "Browse markets" goes to `/`, which
   now redirects to `/t`. Point it at `/m`. Grep for any other `href="/"`
   that means the markets.

7. **`/m/[slug]` swallows every error.** An unknown slug is a 200 that
   resolves client-side. Call `notFound()` for `MARKET_NOT_FOUND`
   (read the Next 16 docs in `node_modules/next/dist/docs/` first), and
   give the market, portfolio and admin pages a `metadata` title.

8. **Formatting outside `format.ts`** (the `AGENTS.md` convention):
   - `toLocaleString` in `forward-ticket.tsx` and `binary-ticket.tsx`
   - σ `toFixed(2)` in `strike-ladder.tsx` and `distribution-chart.tsx`
   - a percent formatter in `market-chart.tsx` that duplicates
     `formatProbability`
   - `v{rulebookVersion}` in `market-activity.tsx`; use `formatVersion`
   - the forward-notional expression
     `formatCents(String(Math.round(quantity*100)))`, written three
     times (`home-activity`, `market-activity`, `portfolio-page`); add
     `formatForwardNotional`
   - binary cash, signed float `formatUsd(cents/100)` in one place and
     unsigned `formatCents` in another; pick one per meaning
   - `formatContractPrice`, which is identical to `formatProbability`;
     keep both names only if `AGENTS.md`'s distinction needs them,
     otherwise alias one to the other
   - `formatPercent`, used only inside `format.ts`; unexport it

9. **Query keys and paths outside `query-keys.ts`.**
   - `admin-comments.tsx` has a local `adminCommentsKey`, and its
     inline URL is not encoded. It duplicates `commentsPath` from
     `use-comment-thread.ts`.
   - `market-workspace.tsx` writes the raw `["openmarket","book"|"instrument"]`
     prefixes.

10. **Request and response layer.**
    - `ADMIN_REQUIRED` maps to 401 even for a signed-in non-admin
      (`response.ts`). A signed-in non-admin should get 403, signed out
      401. C2 may add a cron code here; coordinate.
    - The `quote` and `trade` routes skip the `assertOnlyQueryParameters`
      call that the comment and admin routes make.
    - `withMutationRoute` collapses every schema failure into "Request
      body is invalid." Include the first failing path; never echo
      values.
    - The tickets' `ERROR_TITLES` lack `MARKET_SETTLED` and
      `RESTRICTED_PERSON`.
    - Mutations leave no request/duration log line, unlike
      `withReadRoute`. Log them the same way, with no body, cookie or
      idempotency key.

11. **Accessibility** (WCAG 2.2 AA, `PRODUCT.md`):
    - The forward-mid flash in `market-header.tsx` is colour-only. Add
      the arrow-and-word cue and a polite live region.
    - "Refreshing" flickers on every 4 s poll (`loading={isFetching}` in
      `market-workspace.tsx` and `market-activity.tsx`). Show it only on
      the initial load or a manual refresh.
    - The portfolio sell input has no `type`, so its `min`/`max`/`step`
      do nothing.

12. **"$100,000" is hard-coded** in `binary-ticket.tsx`,
    `forward-ticket.tsx` and `portfolio-page.tsx`. Derive it from
    `INITIAL_USER_BALANCE_CENTS` via the API, or a shared constant the
    client may import as a type-safe value. "Real data only" in
    `AGENTS.md`.

13. **Ticket complexity ignores.** Extract `useBinaryOrder` and
    `useForwardOrder`, the splits the `biome-ignore` comments in
    `binary-ticket.tsx` and `forward-ticket.tsx` name, then remove both
    ignores.

14. **Dead CSS and exports.**
    - `market-activity.module.css`: `.positive`, `.negative` and
      `.visuallyHidden`.
    - `home-stats.module.css` restates `visuallyHidden`; compose the
      shared one instead.
    - `computeBand`/`Band` and `HomeTab` are exported but used only
      locally.
    - The `yes_probability` branch in `market-chart.tsx` is
      unreachable; the chart only ever gets a forward. Confirm, then
      delete it.
    - `.ticketPrompt` is reused for the ladder's "No live forward"
      state. Give that state its own class if the plate rule
      (`DESIGN.md` → Module Tab) says it should not carry a plate.

15. **Polling cost.**
    - `listMarkets` reads listings one at a time, several queries each,
      every 4 s per client. Batch it, with identical output (the
      `listing-read` integration test).
    - The forward preview refetches on every keystroke. Debounce it
      (~250 ms).
    - The portfolio never polls, so "Mid now" and unrealised P&L go
      stale. Poll it like the board.

## Needs decision (do not implement)

- README 6: comment threads keyed by the live epoch's market id.
- Making the API's dollar fields consistent (cent strings versus JSON
  numbers; README D7 now describes the mix). This changes response
  shapes.

## Done when

- Every item is done, did not reproduce, or needs decision.
- `dealer.spec.ts` passes on desktop and mobile with `CI` unset.
- The style and layer audits are clean.
- There are no `biome-ignore`s left in your files except the documented
  `role="group"` and specificity ones.
- The PR has before/after screenshots.
