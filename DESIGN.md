---
name: OpenMarket
description: Paper-money markets read as one ruled rack of labeled white modules.
colors:
  paper-white: "#ffffff"
  paper-raised: "#fafafa"
  paper-hover: "#f6f6f6"
  rule-gray: "#c5c5c5"
  rule-faint: "#e4e4e6"
  press-ink: "#131315"
  ink-soft: "#2c2c30"
  ink-muted: "#55555a"
  utility-red: "#d70909"
  utility-red-pressed: "#b40707"
  red-wash: "#fdeaea"
  movement-green: "#067d21"
  green-wash: "#e7f3e7"
  ink-wash: "#efeff1"
  caution-ochre: "#8a5a00"
  caution-wash: "#fdf3dd"
typography:
  brand:
    fontFamily: "Archivo Black, Arial Black, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Noto Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  metric:
    fontFamily: "Roboto Condensed, Arial Narrow, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Noto Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  detail:
    fontFamily: "Noto Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Roboto Condensed, Arial Narrow, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    letterSpacing: "0.05em"
    lineHeight: 1.2
rounded:
  none: "0"
  chip: "0.25rem"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.5rem"
  "6": "2rem"
  "7": "3rem"
  "8": "4rem"
components:
  button-primary:
    backgroundColor: "{colors.utility-red}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 1rem"
    height: "2.25rem"
  button-primary-hover:
    backgroundColor: "{colors.utility-red-pressed}"
    textColor: "#ffffff"
  button-secondary:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.press-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 0.75rem"
    height: "2.25rem"
  button-secondary-hover:
    backgroundColor: "{colors.red-wash}"
    textColor: "{colors.press-ink}"
  module-tab:
    backgroundColor: "{colors.utility-red}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.5rem 1rem"
  input-field:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.press-ink}"
    rounded: "{rounded.none}"
    height: "2.25rem"
    padding: "0 0.75rem"
  nav-link-active:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.press-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 1rem"
---

# Design System: OpenMarket

## Overview

**Creative North Star: "The Ruled Rack"**

OpenMarket's whole state reads as one ruled rack of labeled modules: a pure white
ground, near-black compact type, and hairline gray rules boxing every module edge
to edge. Utility red carries prices, primary actions, module header tabs,
selection, and errors; a deliberately matched green is reserved for upward
movement and positive gains. The world refuses both the glowing dark terminal and the
soft-shadow SaaS card grid: there is no dark mode (`color-scheme: light` is
pinned), no gradients, no resting shadows, and no rounded card silhouettes.
Density comes from real content only — real markets, real trades, real numbers —
never invented rows.

Everything is set square. Corners are right angles everywhere except the one
sanctioned curve: the company-logo chip (4px). Numbers are tabular everywhere by
a global `font-variant-numeric: tabular-nums`, so columns of prices rack up like
a ledger. Structural labels — table heads, module tabs, nav links, stamps, the
footer disclosure — speak in one voice: bold Roboto Condensed uppercase with
open tracking. Settled status is stamped in outlined ink, like a mark on paper.
Open markets have no status badge.

**Key Characteristics:**
- Light-only world: white ground, ink text, hairline gray rules; depth drawn, never cast.
- Primary accent: utility red (#d70909) for prices, actions, tabs, selection, and errors; green is semantic, not decorative.
- Movement is never color alone: green-up / ink-down always pairs a drawn arrow with a word.
- Square geometry; the 4px logo chip is the only radius.
- Tabular numerals globally; condensed bold caps for every structural label.
- Minimal functional motion (150–220ms ease-out); reduced-motion fully honored.

## Colors

An achromatic paper-and-ink neutral scale with utility red as the primary product
accent, green reserved for upward movement and gains, and ochre for warnings.

### Primary
- **Utility Red** (`--color-primary`, #d70909): the primary product accent. Carries implied-valuation metrics, the trade ticket's tab and the selected tab-strip plate, section-head ticks, primary action fills, the current route's nav rule, text selection, the focus ring, and error text. Pressed/hover state darkens to **Utility Red Pressed** (#b40707). Ticket BUY controls and completion/session notice borders remain red; neither denotes upward movement. The activity tape is ink: its verbs and cash amounts never take red.
- **Red Wash** (`--color-primary-subtle`, #fdeaea): pale red tint for row hover, the implied ladder's depth bars, and secondary-button hover fill.

### Movement and Gains
- **Movement Green** (`--color-positive`, #067d21): upward deltas, their arrows, positive portfolio P&L, and the brief upward price flash. It never colors BUY/YES controls, static prices, ordinary chart series, or generic success notices.
- **Green Wash** (`--color-positive-subtle`, #e7f3e7): upward price-flash background. Downward flashes use Ink Wash; resting prices remain red. Exactly zero P&L is muted, unsigned, and has no Gain/Loss prefix.

**Matched-color derivation.** Tokens are the 8-bit sRGB result of an OKLCH calculation,
not independent swatch choices. Utility Red is approximately
`oklch(55.4382% 0.224196 28.9105)`. Define `Cmax(L, h)` as the largest chroma whose
linear sRGB channels all remain between 0 and 1. The red's relative gamut chroma is
`s = C / Cmax(L, h) = 0.98656`. For green, choose hue 145 and lightness 0.513, then
`C = s * Cmax(0.513, 145) = 0.159179`, yielding #067d21. This preserves the red's
near-maximum relative vividness while lowering lightness enough for small text:
5.30:1 against white, 4.58:1 against Red Wash, and 4.64:1 against Green Wash.
An exact lightness/chroma hue swap falls outside sRGB and does not meet these
contrast requirements; do not substitute it or swap RGB channels. Green Wash
preserves Red Wash's OKLCH lightness (0.952189) and chroma (0.020721) at hue 145.
Recalculate these relationships and contrast on all three surfaces if the red changes.

### Neutral
- **Paper White** (`--color-bg` / `--color-surface`, #ffffff): the universal ground. Modules are white boxes on white, separated only by rules.
- **Paper Raised** (`--color-surface-elevated`, #fafafa): skeleton header bands — a whisper of tone, not an elevation system.
- **Press Ink** (`--color-ink`, #131315): all text, strong borders (header bottom rule, secondary-button border), and downward movement. Filled ink is also the destructive-action color (admin comment removal, hover #2c2c30).
- **Ink Muted** (`--color-ink-muted`, #55555a): secondary text, metric sublabels, timestamps, placeholders.
- **Rule Gray** (`--color-border`, #c5c5c5): the outer hairline that boxes every module.
- **Rule Faint** (`--color-border-subtle`, #e4e4e6): interior hairlines — row separators, column dividers.
- **Ink Wash** (`--color-negative-subtle`, #efeff1): pale neutral tint for down-movement fills and skeleton blocks.
- **Caution Ochre** (`--color-warning`, #8a5a00) on **Caution Wash** (#fdf3dd): reserved for warnings, distinct from movement green and utility red.

### Named Rules
**The Red Interface, Green Movement Rule.** Red is the primary product accent, never decoration. Green means upward movement or a positive gain, not a buy action, a YES outcome, or generic success. Static prices, controls, focus, and errors remain red; downward movement and losses remain ink.

**The Arrow-and-Word Rule.** Movement direction is triple-encoded: color (green up / ink down), a drawn 1.5px stroke arrow, and a word ("up"/"down"). Color alone never carries meaning; flat/unavailable states fall back to muted ink. P&L pairs color with a sign and Gain/Loss label; zero remains neutral.

**The Hairline Rule.** Structure is drawn with 1px rules: Rule Gray (#c5c5c5) for module perimeters, Rule Faint (#e4e4e6) for interior dividers, Press Ink (#131315) only where the world needs a hard edge (the header's bottom rule, stamps, secondary-button borders).

## Typography

**Brand Font:** Archivo Black (with Arial Black) — wordmark only, via next/font (`--font-brand`)
**Body Font:** Noto Sans (with Segoe UI, system-ui) — everything else (`--font-sans`)
**Label Font:** Roboto Condensed (with Arial Narrow) — bold uppercase structural labels (`--font-caps`)

**Character:** A compact grotesque ledger. Noto Sans carries dense analytical
copy at small fixed sizes; Roboto Condensed bold caps stamp the structure;
Archivo Black appears exactly once, as the OPENMARKET wordmark. Tabular numerals
are on globally (set on `html`), so every figure aligns.

### Hierarchy
Six roles: 11 / 13 / 15 / 18 / 24 / 32px. The four text steps climb at ~1.2; the two display steps open to ~1.33 so a page's title and its hero price stand clear of the rows beneath them. Every figure in Roboto Condensed 700 (`--font-num`), every label in Roboto Condensed 700 caps, every sentence in Noto Sans.
- **Brand** (400, 1.5rem, lh 1, -0.02em): the wordmark in the top bar. Nowhere else.
- **Hero price** (`--font-size-2xl` 2rem, red, lh 1): the forward mid in the market page's Quote Band. One per page.
- **Headline / board price** (`--font-size-xl` 1.5rem): page `h1`, the market title, and the red forward mid in each board row.
- **Row title / plate** (`--font-size-lg` 1.125rem): market names in board rows, the YES/NO price plates and the bid/mid/ask figures in the ticket.
- **Body** (`--font-size-md` 0.9375rem, lh 1.5): default copy and the implied ladder's probabilities. Explanatory paragraphs cap at 50–80ch.
- **Detail** (`--font-size-sm` 0.8125rem): table cell values, controls, activity tape lines, ledger values.
- **Label** (`--font-size-xs` 0.6875rem, uppercase, `--tracking-caps` 0.05em): table heads, metric sublabels, seals. Plates (module tabs, section heads, the tab strip, nav, disclosures) open to `--tracking-plate` 0.09em.

**The Named Tracking Rule.** Letter-spacing is one of four role tokens, never a literal (the style audit enforces it): `--tracking-caps` 0.05em for caps labels, `--tracking-plate` 0.09em for plates, `--tracking-headline` −0.01em for headlines and board figures, `--tracking-display` −0.02em for the wordmark.

### Named Rules
**The Caps Voice Rule.** Every structural label — table header, module tab, nav link, stamp, button, disclosure — is bold Roboto Condensed uppercase with at least 0.05em tracking. Content (names, sentences, numbers) is never uppercased. A class carrying the voice composes `.capsLabel` from `shared.module.css` and adds only its size, color and, for a plate, `--tracking-plate`.

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is global, set once on `html`. Any new number-bearing surface inherits it; never opt out, and never restate it.

**The Price Precision Rule.** A quoted level (forward mid, bid, ask, entry, window change, quantile) is formatted with `formatPrice` at four significant digits ($1.117T, $84.27B) so adjacent levels never collapse into the same label. Reported figures (anchors, settlement values) and grid strikes keep the coarser `formatValuation` form because that is how they were published.

**The Baseline Rule.** Every change over a window is measured from the level in force when the window began: the latest mark at or before the window start, else the first mark, else the current metric. The chart summary and its opening point share it. Nothing states the forward mid against the last public round as a change: with no scoop the mid is the round times the tier's step-up, so the board and the Quote Band show the round itself, and the Quote Band names the multiple in a muted note for what it is.

**The Fixed Ramp Rule.** Type sizes are fixed steps from the token ramp (0.6875 / 0.8125 / 0.9375 / 1.125 / 1.5 / 2rem, plus `--font-size-micro` 0.5625rem for seal caps only); no component declares a literal `font-size`; responsive changes swap steps at breakpoints, never fluid `clamp()` type. (The one sanctioned clamp is the page gutter, which is space, not type.)

**The Baseline Rule (rows).** Wherever a tab, a label, a caption, a figure, or a trailing control shares a row with other text, the row aligns by `align-items: baseline`, never by box center: the `/m` index strip, every module header, the ticket header, and the portfolio headers. Mixed fonts and sizes centered by box land on different lines; baselines land on one. Box centering is reserved for rows of controls or icons with no shared text line.

**The Row Rule.** Rows sit on the 4px grid via three tokens: `--row-compact` 2rem (list entries, table heads, ledger rows), `--row-table` 2.5rem (implied ladder and data tables), `--row-board` 4rem (market board). Controls are `--control-height` 2.25rem, small 2rem, large 2.75rem.

## Layout

A full-width work area under a slim sticky top bar, gutter-padded with
`--page-gutter: clamp(0.75rem, 2vw, 1.25rem)` and capped at `--content-max`
(96rem). The shell is a column: sticky header (4rem, white, 1px Press Ink
bottom rule), main region, and a footer band (1px Rule Gray top rule) holding a
tabular copyright line, a centered bold-caps disclosure, and caps links.

- **Markets (`/m`):** the Index Strip (the page `h1` is visually hidden), then a two-column workspace — one tabbed markets module (Board · Distribution) dominant (`minmax(0,1fr)`) with the RECENT TRADES rail box (`minmax(19rem, 23rem)`). Collapses to one column at 72rem. Below, a muted small-print disclosure paragraph (max 80ch).
- **Market page:** the Quote Band, then the forward chart, the read-only implied ladder and the implied distribution (open by default) in the main region with a sticky trade rail (`position: sticky; top: --space-4`) on desktop; under 52rem the rail disappears and a fixed bar naming the working contract and its price opens the ticket in a bottom sheet (fixed, max-height min(88dvh, 48rem), overlay scrim of 34% ink).
- **Board table:** rows are 4rem tall (`--row-board`) with hairline column dividers; under 58rem the table reflows into stacked label/value grids (the `thead` goes visually hidden, `data-label` pseudo-content supplies caps labels).
- **Spacing:** the 8-step rem scale (0.25 → 4rem); modules sit `--space-5` (1.5rem) apart, cell padding is `--space-3` (0.75rem), control height is a uniform 2.25rem.

**The Real Density Rule.** Density comes from real content only. No invented rows, placeholder markets, or filler stats; empty states say what is missing and teach the next action instead.

## Elevation & Depth

Flat. Depth is drawn with hairline rules and pale washes, never cast with
shadows: modules are white boxes outlined in Rule Gray, interiors divided by
Rule Faint, and "raised" surfaces get at most the #fafafa tint. The only
box-shadow in the world is functional, not material: the mobile trade sheet's
edge shadow (`0 -0.25rem 1rem` at 18% ink) over its 34%-ink overlay scrim.

**The No-Resting-Shadow Rule.** Nothing casts a shadow at rest. A shadow may appear only on the mobile sheet (a temporary overlay layer); cards, modules, buttons, and popovers are bounded by rules alone.

**The One Ring Rule.** Focus has one look: `globals.css` draws `--focus-outline` (a 2px Utility Red outline) at `--focus-offset` on every `:focus-visible`, and an input frame draws it on `:focus-within`. No component restyles focus; a full-bleed row inside a clipped box (the ladder's OVER / UNDER folds, the distribution's summary) only turns the same ring inward with a negative offset.

## Shapes

The world is square: the only radius token is `--radius-chip`, and `globals.css`
squares every form control, so no component declares a radius. Buttons, inputs, tables,
tabs, stamps, sheets, and modules are hard rectangles. The single sanctioned
curve is `--radius-chip` (0.25rem) on company-logo chips, whose slight
rounding sets trademarked marks apart from the system's own geometry. Stamps
use a heavier 1.5px outline to read as inked impressions;
everything else rules at 1px. Icons are drawn in-house at a single 1.5px
round-capped stroke (`src/components/icons/icons.tsx`) — no icon fonts, no
third-party glyph sets.

**The One Curve Rule.** Radius exists only on logo chips (4px). Any other rounded corner is a defect.

## Components

### Buttons
- **Shape:** hard rectangle (0 radius), uniform 2.25rem min-height, bold condensed caps at 0.8125rem with 0.05em tracking (composed from `src/styles/shared.module.css` `.buttonBase`).
- **Primary:** Utility Red fill, white text, 1px matching border (#d70909 → #b40707 on hover). Used for trade submission and the top-level primary action.
- **Secondary / Retry:** white fill, 1px Press Ink border, ink caps text; hover swaps to Red Wash fill with red border. One class, `.secondaryButton` in `shared.module.css`; a compact band (the market page's stale notice) composes it at the small control height.
- **Destructive (admin comment removal):** Press Ink fill, white text, hover #2c2c30 — irreversible actions speak in ink, not red.
- **States:** `:active` nudges down 1px; disabled drops to 48% opacity with `not-allowed`; `:focus-visible` gets the one focus ring.

### Module Header Tabs
The world's signature label: a small solid Utility Red plate, one compact row tall (padding 0.5rem 1rem, line-height 1), holding white Roboto Condensed 700 caps at `--font-size-sm` with `--tracking-plate`, sitting flush on top of its ruled module. It is one shared class, `.moduleTab` in `src/styles/shared.module.css`; no file restates it. The solid plate is reserved for the module you act in, the TRADE TICKET and, drawn by the Tab Strip, the selected view. The tab is the module's name, never a control.

**The One Plate Rule.** A page carries at most one solid red name plate outside a tab strip. Every module that is read rather than acted in is named by a Section Head.

### Section Head
Ink Roboto Condensed 700 caps at `--font-size-sm`, `--tracking-plate`, line-height 1, behind a 0.25rem × 0.75rem Utility Red tick (`.sectionHead` in `src/styles/shared.module.css`, composed as each module's `.tab`). Names the forward-mid history, implied ladder, implied distribution, comments, market activity and resolution modules, the portfolio's positions and trade history, and the admin sections.

### Tab Strip (`/m`)
When one module offers several views of the same markets, the views share a tab strip instead of stacking modules. Gray plates (Paper Hover fill, Rule Gray hairline, muted caps at `--font-size-sm`, `--tracking-plate`, `--control-height` tall) sit on a 2px Utility Red rule; the selected plate fills red with white caps and joins the rule. The active view's caption sits right-aligned on the same rule. Panels stay mounted and are hidden, so each keeps its own polling; the panel's own top hairline is dropped under the red rule. Keyboard: arrows, Home and End move focus and selection together (`src/components/home-tabs`).

### Index Strip (`/m`, portfolio)
A Paper Hover band, Rule Gray boxed, of baseline-aligned ruled cells holding only what the page does not already say: open interest in dollars summed over names and the last trade's date and time, with a muted refresh note at the end. Each name's forward mid and last round are the board's, directly beneath; paper cash is the header's. Under 42rem the cells drop their rules. The portfolio's summary (cash, forward collateral, forward unrealised, binary holdings, account value in red) uses the same band, its cells stacking one per row under the portfolio's narrow breakpoint.

**The Say-It-Once Rule.** A figure appears once per screen. A strip, rail or header never repeats the board's or another module's numbers; it carries what nothing else on the page does.

### Rail Box Head
A side-rail module is named by a quieter head than the red tab: Paper Hover band, 2px Utility Red top rule, ink caps at `--font-size-sm`, closed by the module's own hairlines ("RECENT TRADES").

### Hanko Seals (status)
Status is a seal pressed onto the record, not a badge: a 2.5rem circle, 2px ring with an inner hairline ring, caps text at 0.5625rem, rotated −8° as a hand stamp lands (`.seal` in `shared.module.css`, color via `--seal-color`).
- **OPEN:** No badge or seal beside the market title; trading controls communicate availability.
- **Where it is used today:** only the ticket's approval strip (OK / Filled, `.approvalSeal`). No page shows a SETTLED seal: the market page shows live epochs only, and the portfolio marks a settled row with the text "· Settled". A settled state, when built, uses a Press Ink seal with a muted settled date beneath.
Seals are outlined, never filled — fill belongs to tabs and actions. On the board, open markets show a TRADE button in the status column instead of a seal, because that column is where the action lives.

### Spec Tables
The 商品情報 convention for key facts: a hairline-boxed `dl` whose label cells (`dt`) are Paper Hover gray with caps labels and a right hairline, value cells (`dd`) white with right-aligned condensed figures, every row `--row-compact` and ruled (`.specTable` in `shared.module.css`; a module sets `--spec-label` for the label column and `--spec-pad` for cell padding). Used for the ticket's quote and the Distribution tab's band facts.

### Quote Band (market page)
The market page opens on one ruled row, 2px Press Ink top rule over a Rule Gray box: the identity cell (logo chip, `h1`, tier and prompt), then figure cells divided by Rule Faint hairlines, each a caps label over a figure over a muted note: the forward mid as the hero price with bid and ask beneath; the last round's post-money with the round, date and source link, and a muted note naming the mid's multiple of it as the model's step-up; the implied 80% band with the most likely bucket and its mass; the binary's YES price with its quarter expiry and the model p; open interest split into forward and binary; and the last trade's date and time. Under 72rem the identity takes its own row; under 52rem the cells pair up two per row. Every figure is the API's.

### Implied Ladder (板, signature, read-only)
A two-column spine reading highest strike first: the strike centered in bold condensed type, and the implied P(next print > strike) in red on the right, both from the API's implied distribution (a lognormal at the forward mid with the tier's σ). Behind each strike a Red Wash bar shows the probability mass of the bucket just below it. A ruled **current row** (red top and bottom hairlines, caps FORWARD MID label, red figure) sits between the two strikes bracketing the forward mid. Tails with P outside 5–95% fold into **OVER / UNDER** rows above and below the book stating how many strikes they hide and their edge probability; clicking unfolds them. The book has no vertical scroll box. No strike is tradable (only the OVER / UNDER folds are controls): the ladder is not traded, and its head says so.

### Market Board Rows (signature)
`--row-board` 4rem table rows on white, one per listed name: 2.5rem logo chip + row-title name link (underline draws in red on hover) over its tier, the red board-price forward mid, the dealer's bid / ask in condensed figures, the last round (its post-money in ink over the round and date, muted), the binary's red YES price over its quarter expiry, open interest, and a TRADE button to the market page. The mid is never compared to the round as movement: with no scoop the mid is the last round times the tier's step-up, the same multiple for every name in a tier, so it is not news. TRADE rests as a secondary button and fills red only for the row under the pointer or holding focus: five resting red buttons would out-shout the five red prices. Row hover washes the row Red Wash.

### Where the Market Lands (`/m`, Distribution tab)
One row per listed name, in the Distribution tab beside the board. A log-scaled axis in four annotation rows so nothing can collide: the median label above in red; the box (10th–90th percentile, hairline-ruled Red Wash) on the axis with the median drawn as a 2px red line only inside it; the P10 and P90 figures under the box ends in muted caps-prefixed numerals; the last round as a small ink triangle on the underside of the axis with its label in the last row. The axis is the band plus half a decade each side, widened to admit the round. A two-row Spec Table beside it states the band in figures and the most likely bucket with its probability mass in red. The band, median and most likely bucket are the API's (`distribution.band`, `distribution.mode`), grid quantiles of the implied distribution around the forward mid. A name with no live forward shows a one-line note instead of a band. Rows are `--row-board`; on narrow screens the row stacks.

### Trade Ticket (order form)
One ticket per page under the page's single red plate, live from first paint on the forward's LONG side. The header names the working contract in ink at body size ("LONG · Next post-money", "YES · Public S-1 by Dec 31, 2026"). An ink segmented control switches **Forward / Binary**; each states its question and expiry. Reads top to bottom in the order a brokerage 注文 form does; the approval strip comes last, under the action that drives it:
- **Forward:** a LONG / SHORT ink segmented control; the dealer's two-way quote as three ruled figure cells (BID · MID · ASK, the side a fill takes ruled red on top with its figure red); a caution band while an event flag widens the quote; a dollar notional with quick chips; then the quote — notional, entry (the ask for a long, the bid for a short), collateral, max loss, max gain, expiry, model · rulebook versions — polled from the instrument quote every refresh. The entry on screen is the bound on the wire. A notional over the cap shows an inline refusal with USE MAXIMUM; a pulled side shows the refusal alone. Copy states that a position is held to settlement or void, with no early close.
- **Binary — side plates:** two large hairline-framed plates showing YES and NO with each side's price; the pressed plate fills solid (red for YES, ink for NO). A trade that would leave the dealer's [p_floor, 1 − p_floor] band is refused with that message.
- **Segmented controls (contract, Long/Short, Buy/Sell, mode):** hairline-framed white track; buttons are borderless, muted-ink text; the pressed segment fills Press Ink with white text, like the pressed amount chip; in the ticket, red is left to the YES plate, the side of the quote a fill takes, and the submit button.
- **Inputs:** 2.25rem hairline-framed white fields, ink text, tabular numerals; a row of four quick-amount chips beneath (pressed chip fills ink).
- **Quote:** a Spec Table of the quoted figures including the bound the wire carries (MAX COST for buys, MIN PROCEEDS for sells), followed by a **date stamp** — a hairline-boxed caps "QUOTED | time" mark — and the previews-not-reservations note. A moved price re-renders the same table from the server's requote under a "REQUOTED" stamp, never an abbreviated box. Errors are inline red text; an order whose outcome is unknown locks every input and offers exactly one RETRY (same request key) and one ABANDON.
- **Sticky action:** the submit button and the approval strip sit in a bar pinned to the foot of the rail's (or the sheet's) scroll box, top-ruled on white, so the action stays in view however long the quote above it runs.
- **Approval strip (稟議):** three ruled boxes — QUOTED, SENT, FILLED — each receiving a small seal only once the order has provably cleared that stage. SENT seals when the request leaves the browser and stays sealed while the outcome is unknown; FILLED seals only on a server 200 and shows a muted `?` while an order's outcome is unknown. Boxes never un-seal. Empty boxes are hairline squares; a sealed box carries the rotated ring.
- Desktop: sticky right rail; mobile: a fixed bottom bar shows the working contract and its price (the ask or bid, or the side's probability) with a TRADE button that opens the bottom sheet (see Layout) with focus trapped inside.

### Navigation
Caps links (Roboto Condensed 700, 0.9375rem, `--tracking-plate`) running the top bar's full height; hover washes Red Wash; the current route stays ink and carries a 3px Utility Red rule on the header's foot. Nav is never a red plate: the One Plate Rule keeps the solid plate for the module you act in. A skip link drops in from the top-left as an ink-filled block on focus.

### Company Logo Chip
A white hairline-framed plate (1.75 / 2.25 / 2.5rem sizes) with 4px radius holding the real brand mark at roughly 60% of the plate (`public/logos/*.svg`, official logomarks in their brand color). A muted caps initials fallback appears only when the mark fails to load, never behind it.

### Activity Tape
A ruled list of entries (min 3.5rem) separated by faint hairlines: caps BOUGHT / SOLD (binary) and LONG / SHORT (forward) verbs inline in body-size sentences, an ink signed cash amount, with a muted tabular metadata line whose links underline in red on hover.

### Market Comments
A ruled white module between Distribution and Market Activity, labeled with the
shared COMMENTS tab. Flat rows show the author's tournament name, muted exact timestamp,
and plain body text capped at 80ch; line breaks remain visible. Replies indent one
level only. No avatars, badges, likes, rich text, or decorative colors. The composer
says which tournament name a post carries and holds drafts through account
changes and failed submissions. New arrivals wait behind a reveal button; removed
content leaves a neutral tombstone. Open markets have no red OPEN badge.

### Loading, Empty, and Error States
Skeletons match the real layout (logo square, name bar, metric bar, chart block) and pulse #efeff1 → #e4e4e6 over 1.6s; hairline-boxed state panels (`.statePanel` in `shared.module.css`) carry a bold one-liner, a muted explanation (≤60ch), and a secondary RETRY button. An empty portfolio section is a single ruled line instead: what is missing in bold, then the next step. Reduced motion stops the pulse. A quiet window on a traded market is not empty: the history chart holds the level in force at the window start flat to now, and its summary says no trades fell in the range and when the last one was. Only a market with no trades at all shows the first-trade message.

### Motion (system-wide)
Two durations only — `--duration-fast` 150ms and `--duration-standard` 220ms — on one curve, `cubic-bezier(0.16, 1, 0.3, 1)` ease-out. Sanctioned movements: background/border/color transitions, the 1px button press, the chevron rotate, the metric flash (Green Wash for up, Ink Wash for down, with a direction-colored figure that returns to resting red), the sheet slide-up with overlay fade, and the skeleton pulse. `prefers-reduced-motion` disables all of it, globally and per-module. No entrances, parallax, bouncing, or infinite decorative motion.

## Do's and Don'ts

### Do:
- **Do** box every module edge to edge with a 1px Rule Gray border and divide interiors with Rule Faint hairlines.
- **Do** give every structural label the caps voice: Roboto Condensed 700, uppercase, ≥0.05em tracking.
- **Do** triple-encode movement — color, drawn arrow, word — and set all figures in tabular numerals.
- **Do** keep every control at the shared 2.25rem height and leave its focus to the one global ring.
- **Do** hold WCAG 2.2 AA: visible focus rings, keyboard-operable ticket controls, semantic tables/lists, textual chart summaries, focus-trapped sheets (per PRODUCT.md).
- **Do** honor `prefers-reduced-motion` in every module that animates, on top of the global kill switch.

### Don't:
- **Don't** introduce a dark mode, extra decorative accent hues, or gradients — the world is light-only with red as its primary accent; green and ochre have narrow semantic roles.
- **Don't** use red or green decoratively, or use color as the only carrier of movement, status, or selection.
- **Don't** round corners (except the 4px logo chip) or cast resting shadows — depth is drawn with rules.
- **Don't** import icon fonts or third-party glyph sets; draw icons at the single 1.5px round-capped stroke.
- **Don't** fabricate density: no invented rows, filler markets, or decorative stats; empty states teach instead.
- **Don't** scale type fluidly; swap fixed ramp steps at structural breakpoints.
