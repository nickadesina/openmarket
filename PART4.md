# Part 4 — Product Interface

Part 4 consumes the verified engine, persistence, service, and read API layers in `PART1.md` through `PART3.md`. `PRODUCT.md` and `DESIGN.md` are authoritative for product direction and visual implementation.

## Product direction

Institutional, analytical, restrained. Probability and execution evidence lead. Avoid crypto-casino aesthetics, neon decoration, gamification, generic dashboard cards, and cramped legacy-terminal behavior.

## Routes and pages

- `/`: server-rendered market board plus global activity.
- `/m/[slug]`: server-rendered listed name: quote band, forward chart, read-only implied ladder and distribution, the trade rail (forward and binary tickets), comments, activity and resolution criteria.
- `/portfolio`: authenticated cash, account value, open forward positions, binary holdings with sell actions, and paginated history.
- `/admin`: comment moderation, for the tournament admin allowlist (README D1).
- Mutation APIs: `/api/quote` and `/api/trade` (a binary by `market_id`), `/api/forward/trade`, `/api/admin/comments/[commentId]/remove`; sign-in is the tournament's (`/t/signin`).

## Interaction contracts

- TanStack Query polls market state/activity every four seconds.
- Successful trades invalidate and re-fetch market, marks, activity, and portfolio, including idempotent replay responses.
- The client never invents a new market price optimistically.
- Binary buy accepts quantity or dollar spend; sell accepts quantity only. A forward opens long or short at a dollar notional and is held to settlement or void.
- Price-moved responses show the new authoritative quote and require confirmation.
- Desktop market layout: chart, implied ladder and distribution in the main region; persistent trade rail; lower comments/activity/resolution region.
- Mobile: single column; a fixed bar opens the ticket in an accessible Radix Dialog bottom sheet.
- All surfaces implement layout-matched loading, retryable error, empty, settled, disabled/executing, insufficient-cash/holdings, and reduced-motion states.

## Visual contracts

- CSS Modules and global OKLCH tokens only; no Tailwind or CSS-in-JS.
- One product sans stack with tabular numerals for market data.
- One accent only: Utility Red as defined in `DESIGN.md`. No second hue, no violet/graphite/cyan palette.
- Movement always includes an arrow/text cue, never color alone.
- Charts expose textual summaries. Focus is visible. Controls are keyboard reachable.
- Motion lasts 150–220ms and communicates state only.

## Completion gate

Desktop and mobile surfaces are visually inspected in the actual browser. The ladder's browser flows (quote, buy, replay, sell, price movement, settlement) were deleted with the ladder markets they seeded (milestone 6); the dealer specs (`tests/browser/dealer.spec.ts`) cover the board, the market page, a forward long through to the portfolio, a binary YES buy, a moved price, mobile overflow and keyboard reach, alongside sign-in, the paper account's opening balance, admin gating and the tournament.
