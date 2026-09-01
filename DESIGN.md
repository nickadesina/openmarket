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
  ink-wash: "#efeff1"
  caution-ochre: "#8a5a00"
  caution-wash: "#fdf3dd"
  focus-halo: "#f5b5b5"
typography:
  brand:
    fontFamily: "Archivo Black, Arial Black, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Noto Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "1.4375rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  metric:
    fontFamily: "Noto Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Noto Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  detail:
    fontFamily: "Noto Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "0.78125rem"
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
  chip: "0.4375rem"
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
    padding: "0.375rem 0.875rem"
  stamp-open:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.utility-red}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 0.75rem"
    height: "1.625rem"
  stamp-settled:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.press-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 0.75rem"
    height: "1.625rem"
  input-field:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.press-ink}"
    rounded: "{rounded.none}"
    height: "2.25rem"
    padding: "0 0.75rem"
  nav-link-active:
    backgroundColor: "{colors.utility-red}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.5rem 1.125rem"
---

# Design System: OpenMarket

## Overview

**Creative North Star: "The Ruled Rack"**

OpenMarket's whole state reads as one ruled rack of labeled modules: a pure white
ground, near-black compact type, and hairline gray rules boxing every module edge
to edge. A single utility red is the only voice in the room — it carries prices,
movement upward, primary actions, module header tabs, selection, and errors, and
nothing else. The world explicitly refuses both the glowing dark terminal and the
soft-shadow SaaS card grid: there is no dark mode (`color-scheme: light` is
pinned), no gradients, no resting shadows, and no rounded card silhouettes.
Density comes from real content only — real markets, real trades, real numbers —
never invented rows.

Everything is set square. Corners are right angles everywhere except the one
sanctioned curve: the company-logo chip (7px). Numbers are tabular everywhere by
a global `font-variant-numeric: tabular-nums`, so columns of prices rack up like
a ledger. Structural labels — table heads, module tabs, nav links, stamps, the
footer disclosure — speak in one voice: bold Roboto Condensed uppercase with
open tracking. Status is stamped, not badged: outlined red OPEN, outlined ink
SETTLED, like ink stamps on paper.

**Key Characteristics:**
- Light-only world: white ground, ink text, hairline gray rules; depth drawn, never cast.
- One accent: utility red (#d70909) for prices, up-movement, actions, tabs, selection, errors.
- Movement is never color alone: red-up / ink-down always pairs a drawn arrow with a word.
- Square geometry; the 7px logo chip is the only radius.
- Tabular numerals globally; condensed bold caps for every structural label.
- Minimal functional motion (150–220ms ease-out); reduced-motion fully honored.

## Colors

An achromatic paper-and-ink neutral scale with one saturated utility red doing
all semantic work.

### Primary
- **Utility Red** (`--color-primary`, #d70909): the single accent. Carries implied-valuation metrics, module header tab fills, primary action fills, active nav fills, selected segmented-control fills, sparkline strokes, text selection, focus outlines, error text, and upward movement. Pressed/hover state darkens to **Utility Red Pressed** (#b40707).
- **Red Wash** (`--color-primary-subtle`, #fdeaea): pale red tint for row hover, ladder pivot-row highlight, metric flash-from color, and secondary-button hover fill.

### Neutral
- **Paper White** (`--color-bg` / `--color-surface`, #ffffff): the universal ground. Modules are white boxes on white, separated only by rules.
- **Paper Raised** (`--color-surface-elevated`, #fafafa): logo-chip fill, skeleton header bands — a whisper of tone, not an elevation system.
- **Press Ink** (`--color-ink`, #131315): all text, strong borders (header bottom rule, SETTLED stamp, secondary-button border), and downward movement. Filled ink is also the destructive-action color (admin settle button, hover #2c2c30).
- **Ink Muted** (`--color-ink-muted`, #55555a): secondary text, metric sublabels, timestamps, placeholders.
- **Rule Gray** (`--color-border`, #c5c5c5): the outer hairline that boxes every module.
- **Rule Faint** (`--color-border-subtle`, #e4e4e6): interior hairlines — row separators, column dividers, sparkline baselines.
- **Ink Wash** (`--color-negative-subtle`, #efeff1): pale neutral tint for down-movement fills and skeleton blocks.
- **Caution Ochre** (`--color-warning`, #8a5a00) on **Caution Wash** (#fdf3dd): the only non-red semantic pair, for warnings.

### Named Rules
**The One Red Rule.** Red is utility, never decoration. If an element is not a price, an upward movement, a primary action, a module tab, a selection, or an error, it does not get red.

**The Arrow-and-Word Rule.** Movement direction is triple-encoded: color (red up / ink down), a drawn 1.5px stroke arrow, and a word ("up"/"down"). Color alone never carries meaning; flat/unavailable states fall back to muted ink.

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
- **Brand** (400, 1.5rem, lh 1, -0.02em): the wordmark in the top bar. Nowhere else.
- **Headline** (700, 1.4375rem `--font-size-xl`, lh 1.2): page `h1`, balanced wrap; drops to 1.0625rem on small screens.
- **Metric** (700, 1.625rem, -0.02em, red): the big implied-valuation figures in board rows and header stat strips; 1.0625rem on mobile.
- **Body** (400, 0.875rem `--font-size-md`, lh 1.5): default copy. Explanatory paragraphs cap at 50–80ch.
- **Detail** (400–600, 0.78125rem `--font-size-sm`): table cell values, activity tape lines, metadata.
- **Label** (Roboto Condensed 700, 0.6875rem `--font-size-xs`, uppercase, 0.05em tracking): table heads, metric sublabels, stamps, footer disclosure. Tabs and nav widen tracking to 0.08–0.1em.

### Named Rules
**The Caps Voice Rule.** Every structural label — table header, module tab, nav link, stamp, button, disclosure — is bold Roboto Condensed uppercase with at least 0.05em tracking. Content (names, sentences, numbers) is never uppercased.

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is global. Any new number-bearing surface inherits it; never opt out.

**The Fixed Ramp Rule.** Type sizes are fixed steps from the token ramp (0.6875 / 0.78125 / 0.875 / 1.0625 / 1.4375 / 1.875rem); responsive changes swap steps at breakpoints, never fluid `clamp()` type. (The one sanctioned clamp is the page gutter, which is space, not type.)

## Layout

A full-width work area under a slim sticky top bar, gutter-padded with
`--page-gutter: clamp(0.75rem, 2vw, 1.25rem)` and capped at `--content-max`
(96rem). The shell is a column: sticky header (4.125rem, white, 1px Press Ink
bottom rule), main region, and a footer band (1px Rule Gray top rule) holding a
tabular copyright line, a centered bold-caps disclosure, and caps links.

- **Home:** page header row (headline + muted subline + caps refresh note over a hairline), then a two-column workspace — MARKET BOARD dominant (`minmax(0,1fr)`, roughly 2/3) with the LIVE ACTIVITY tape right rail (`minmax(20rem, 26rem)`). Collapses to one column at 84rem. Below, a muted small-print disclosure paragraph (max 80ch).
- **Market page:** chart and strike ladder in the main region with a sticky trade rail (`position: sticky; top: --space-4`) on desktop; under 52rem the rail disappears and the selected strike opens a bottom sheet (fixed, max-height min(88dvh, 48rem), overlay scrim of 34% ink).
- **Board table:** rows are 4.5rem tall with hairline column dividers; under 58rem the table reflows into stacked label/value grids (the `thead` goes visually hidden, `data-label` pseudo-content supplies caps labels) and the inline ladder/expand affordance is suppressed in favor of the market page.
- **Spacing:** the 8-step rem scale (0.25 → 4rem); modules sit `--space-5` (1.5rem) apart, cell padding is `--space-3` (0.75rem), control height is a uniform 2.25rem.

**The Real Density Rule.** Density comes from real content only. No invented rows, placeholder markets, or filler stats; empty states say what is missing and teach the next action instead.

## Elevation & Depth

Flat. Depth is drawn with hairline rules and pale washes, never cast with
shadows: modules are white boxes outlined in Rule Gray, interiors divided by
Rule Faint, and "raised" surfaces get at most the #fafafa tint. The only
box-shadows in the world are functional, not material: the focus halo
(`0 0 0 0.1875rem #f5b5b5`) and the mobile trade sheet's edge shadow
(`0 -0.25rem 1rem` at 18% ink) over its 34%-ink overlay scrim.

**The No-Resting-Shadow Rule.** Nothing casts a shadow at rest. A shadow may appear only on the mobile sheet (a temporary overlay layer) and as the focus ring; cards, modules, buttons, and popovers are bounded by rules alone.

## Shapes

The world is square: `--radius-sm/md/lg` are all 0. Buttons, inputs, tables,
tabs, stamps, sheets, and modules are hard rectangles. The single sanctioned
curve is `--radius-chip` (0.4375rem) on company-logo chips, whose slight
rounding sets trademarked marks apart from the system's own geometry. Stamps
(OPEN/SETTLED) use a heavier 1.5px outline to read as inked impressions;
everything else rules at 1px. Icons are drawn in-house at a single 1.5px
round-capped stroke (`src/components/icons/icons.tsx`) — no icon fonts, no
third-party glyph sets.

**The One Curve Rule.** Radius exists only on logo chips (7px). Any other rounded corner is a defect.

## Components

### Buttons
- **Shape:** hard rectangle (0 radius), uniform 2.25rem min-height, bold condensed caps at 0.8125rem with 0.05em tracking (composed from `src/styles/shared.module.css` `.buttonBase`).
- **Primary:** Utility Red fill, white text, 1px matching border (#d70909 → #b40707 on hover). Used for trade submission and the top-level primary action.
- **Secondary / Retry:** white fill, 1px Press Ink border, ink caps text; hover swaps to Red Wash fill with red border.
- **Destructive (admin settle):** Press Ink fill, white text, hover #2c2c30 — irreversible actions speak in ink, not red.
- **States:** `:active` nudges down 1px; disabled drops to 48% opacity with `not-allowed`; `:focus-visible` gets the pale-red halo ring.

### Module Header Tabs
The world's signature label: a small solid Utility Red rectangle (padding 0.375rem 0.875rem) holding white Roboto Condensed 700 caps at 0.78125rem with 0.09em tracking, sitting flush on top of its ruled module ("MARKET BOARD", "LIVE ACTIVITY", "TRADE"). One tab per module; the tab is the module's name, never a control.

### Status Stamps
- **OPEN:** 1.5px Utility Red outline, red caps text, transparent fill, 1.625rem tall, 0.08em tracking.
- **SETTLED:** identical geometry in Press Ink, paired with a muted settled date beneath.
Stamps are outlined, never filled — fill belongs to tabs and actions.

### Market Board Rows (signature)
4.5rem table rows on white: logo chip + bold market-name link (underline draws in red on hover), red Metric-size implied valuation with a muted caps sublabel, Arrow-and-Word change cell, red 1.5px sparkline over a faint baseline, anchor claim, and stamp. Row hover washes the row Red Wash. The leading cell is a 1.75rem square expand button (1px Rule Gray, chevron rotating 90°; red-filled with white glyph when `aria-expanded="true"`) that opens an **inline ladder row**: YES/NO strike tables in an `auto-fit minmax(18rem, 1fr)` column grid, pivot row highlighted in Red Wash, YES prices in red 700, capped by a caps "view market" link.

### Trade Ticket
- **Segmented controls (YES/NO, mode):** hairline-framed white track; buttons are borderless, muted-ink text; the pressed segment fills Utility Red with white text.
- **Inputs:** 2.25rem hairline-framed white fields, ink text, tabular numerals, muted placeholders; `:focus-within` shows the halo ring instead of a border change.
- **Quote block:** hairline-separated rows of tabular figures; errors are inline red text with a retry path.
- Desktop: sticky right rail under a red TRADE tab; mobile: bottom sheet (see Layout) with focus trapped inside.

### Navigation
Caps links (Roboto Condensed 700, 0.9375rem, 0.08em tracking) in the top bar; hover washes Red Wash; the active route is a solid Utility Red block with white text (hover #b40707). A skip link drops in from the top-left as an ink-filled block on focus.

### Company Logo Chip
The only rounded element: a bordered square frame (2 / 2.25 / 2.5rem sizes) with 7px radius, Paper Raised fill, containing the mark or a muted bold-caps ticker fallback.

### Activity Tape
A ruled list of 4rem entries separated by faint hairlines: caps BUY (red) / SELL (ink) verbs inline in body-size sentences, with a muted tabular metadata line whose links underline in red on hover.

### Loading, Empty, and Error States
Skeletons match the real layout (logo square, name bar, metric bar, chart block) and pulse #efeff1 → #e4e4e6 over 1.6s; hairline-boxed state panels carry a bold one-liner, a muted explanation (≤60ch), and an outlined RETRY button. Reduced motion stops the pulse.

### Motion (system-wide)
Two durations only — `--duration-fast` 150ms and `--duration-standard` 220ms — on one curve, `cubic-bezier(0.16, 1, 0.3, 1)` ease-out. Sanctioned movements: background/border/color transitions, the 1px button press, the chevron rotate, the metric flash (background decays from Red Wash while the figure shows Arrow-and-Word color), the sheet slide-up with overlay fade, and the skeleton pulse. `prefers-reduced-motion` disables all of it, globally and per-module. No entrances, parallax, bouncing, or infinite decorative motion.

## Do's and Don'ts

### Do:
- **Do** box every module edge to edge with a 1px Rule Gray border and divide interiors with Rule Faint hairlines.
- **Do** give every structural label the caps voice: Roboto Condensed 700, uppercase, ≥0.05em tracking.
- **Do** triple-encode movement — color, drawn arrow, word — and set all figures in tabular numerals.
- **Do** keep every control at the shared 2.25rem height with the 0.1875rem pale-red focus halo on `:focus-visible`.
- **Do** hold WCAG 2.2 AA: visible focus rings, keyboard-operable ticket controls, semantic tables/lists, textual chart summaries, focus-trapped sheets (per PRODUCT.md).
- **Do** honor `prefers-reduced-motion` in every module that animates, on top of the global kill switch.

### Don't:
- **Don't** introduce a dark mode, a second accent hue, or gradients — the world is light-only with one red.
- **Don't** use red decoratively, or use color as the only carrier of movement, status, or selection.
- **Don't** round corners (except the 7px logo chip) or cast resting shadows — depth is drawn with rules.
- **Don't** import icon fonts or third-party glyph sets; draw icons at the single 1.5px round-capped stroke.
- **Don't** fabricate density: no invented rows, filler markets, or decorative stats; empty states teach instead.
- **Don't** scale type fluidly; swap fixed ramp steps at structural breakpoints.
