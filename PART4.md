# Part 4 — Product Interface

Part 4 consumes the verified engine, persistence, service, and read API layers in `PART1.md` through `PART3.md`. `PRODUCT.md` and `DESIGN.md` are authoritative for product direction and visual implementation.

## Product direction

Institutional, analytical, restrained. Probability and execution evidence lead. Avoid crypto-casino aesthetics, neon decoration, gamification, generic dashboard cards, and cramped legacy-terminal behavior.

## Routes and pages

- `/`: server-rendered market board plus global activity.
- `/m/[slug]`: server-rendered market detail, chart, strike ladder, trade rail, activity, distribution, and resolution criteria.
- `/portfolio`: authenticated cash, account value, decomposed positions, residual exposure, sell actions, and paginated history.
- `/admin`: admin login, seed, and irreversible settlement operations.
- Mutation APIs: `/api/user`, `/api/quote`, `/api/trade`, `/api/admin/login`, `/api/admin/seed`, `/api/admin/settle`.

## Interaction contracts

- TanStack Query polls market state/activity every four seconds.
- Successful trades invalidate and re-fetch market, marks, activity, and portfolio, including idempotent replay responses.
- The client never invents a new market price optimistically.
- Buy accepts quantity or dollar spend. Sell accepts quantity only.
- Price-moved responses show the new authoritative quote and require confirmation.
- Desktop market layout: chart and ladder main region; persistent 320–360px trade rail; lower distribution/activity/resolution region.
- Mobile: single column; strike selection opens an accessible Radix Dialog bottom sheet.
- All surfaces implement layout-matched loading, retryable error, empty, settled, disabled/executing, insufficient-cash/holdings, and reduced-motion states.

## Visual contracts

- CSS Modules and global OKLCH tokens only; no Tailwind or CSS-in-JS.
- One product sans stack with tabular numerals for market data.
- One accent only: Utility Red as defined in `DESIGN.md`. No second hue, no violet/graphite/cyan palette.
- Movement always includes an arrow/text cue, never color alone.
- Charts expose textual summaries. Focus is visible. Controls are keyboard reachable.
- Motion lasts 150–220ms and communicates state only.

## Completion gate

The critical browser flow covers anonymous quote, username creation, buy, idempotent replay, authoritative refresh, partial sell, sell-spend rejection, price movement recovery, and admin settlement. Desktop and mobile surfaces are visually inspected in the actual browser.
