---
name: OpenMarket
description: A marks index read as one ruled rack of labeled white modules.
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
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  metric:
    fontFamily: "Roboto Condensed, Arial Narrow, sans-serif"
    fontSize: "1.75rem"
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
    backgroundColor: "{colors.utility-red}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.5rem 1rem"
---

# Design System: OpenMarket

## Overview

**Creative North Star: "The Ruled Rack"**

OpenMarket's whole state reads as one ruled rack of labeled modules: a pure white
ground, near-black compact type, and hairline gray rules boxing every module edge
to edge. Utility red carries the index's figure (the consensus mark), primary
actions, the active nav plate, section ticks, selection, and errors; a
deliberately matched green is reserved for upward movement. The world refuses both the glowing dark terminal and the
soft-shadow SaaS card grid: there is no dark mode (`color-scheme: light` is
pinned), no gradients, no resting shadows, and no rounded card silhouettes.
Density comes from real content only — real filings, real marks, real numbers —
never invented rows.

Everything is set square. Corners are right angles everywhere except the one
sanctioned curve: the company-logo chip (4px). Numbers are tabular everywhere by
a global `font-variant-numeric: tabular-nums`, so columns of prices rack up like
a ledger. Structural labels — table heads, figure labels, tags, nav links, the
footer disclosure — speak in one voice: bold Roboto Condensed uppercase with
open tracking. Every figure carries a link to the filing it came from.

**Key Characteristics:**
- Light-only world: white ground, ink text, hairline gray rules; depth drawn, never cast.
- Primary accent: utility red (#d70909) for the consensus figure, actions, the active nav plate, selection, and errors; green is semantic, not decorative.
- Movement is never color alone: green-up / ink-down always pairs a drawn arrow with a word.
- Square geometry; the 4px logo chip is the only radius.
- Tabular numerals globally; condensed bold caps for every structural label.
- Minimal functional motion (150–220ms ease-out); reduced-motion fully honored.

## Colors

An achromatic paper-and-ink neutral scale with utility red as the primary product
accent, green reserved for upward movement and gains, and ochre for warnings.

### Primary
- **Utility Red** (`--color-primary`, #d70909): the primary product accent. Carries the consensus mark wherever it is the index's figure (daily page, name page figures, consensus tables), the chart's consensus line and points, section-head ticks, the active nav fill, primary action fills, text selection, focus outlines, and error text. Pressed/hover state darkens to **Utility Red Pressed** (#b40707).
- **Red Wash** (`--color-primary-subtle`, #fdeaea): pale red tint for the chart's range band (one as-of date's family marks), an anchored row (`:target`), nav hover and secondary-button hover fill.

### Movement and Gains
- **Movement Green** (`--color-positive`, #067d21): upward deltas and their arrows. No index page uses it today: revisions and mark versus print are stated as signed percents with the word up or down. It never colors static figures, ordinary chart series, or generic success notices.
- **Green Wash** (`--color-positive-subtle`, #e7f3e7): reserved with Movement Green.

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
- **Paper Raised** (`--color-surface-elevated`, #fafafa): a whisper of tone, not an elevation system.
- **Press Ink** (`--color-ink`, #131315): all text, strong borders (header bottom rule, secondary-button border), and downward movement. Filled ink is also the destructive-action color (hover #2c2c30).
- **Ink Muted** (`--color-ink-muted`, #55555a): secondary text, metric sublabels, timestamps, placeholders.
- **Rule Gray** (`--color-border`, #c5c5c5): the outer hairline that boxes every module.
- **Rule Faint** (`--color-border-subtle`, #e4e4e6): interior hairlines — row separators, column dividers.
- **Ink Wash** (`--color-negative-subtle`, #efeff1): pale neutral tint for down-movement fills and skeleton blocks.
- **Caution Ochre** (`--color-warning`, #8a5a00): what the page cannot say and why — the ruled notes' left rule and caps head (no filer marks, not transcribed, no unit quotes, listed), the intra-family split flag, the rulebook's not-built notes. Caution Wash (#fdf3dd) is reserved.

### Named Rules
**The Red Interface, Green Movement Rule.** Red is the primary product accent, never decoration. Green means upward movement, not generic success. The consensus figure, controls, focus, and errors remain red; downward movement remains ink.

**The Arrow-and-Word Rule.** Movement direction is triple-encoded: color (green up / ink down), a drawn 1.5px stroke arrow, and a word ("up"/"down"). Color alone never carries meaning; flat/unavailable states fall back to muted ink. A signed change (a revision, mark versus print) carries its sign and the word up or down.

**The Hairline Rule.** Structure is drawn with 1px rules: Rule Gray (#c5c5c5) for module perimeters, Rule Faint (#e4e4e6) for interior dividers, Press Ink (#131315) only where the world needs a hard edge (the header's bottom rule, stamps, secondary-button borders).

## Typography

**Brand Font:** Archivo Black (with Arial Black) — wordmark only, via next/font (`--font-brand`)
**Body Font:** Noto Sans (with Segoe UI, system-ui) — everything else (`--font-sans`)
**Label Font:** Roboto Condensed (with Arial Narrow) — bold uppercase structural labels (`--font-caps`)

**Character:** A compact grotesque ledger. Noto Sans carries dense analytical
copy at small fixed sizes; Roboto Condensed bold caps stamp the structure;
Archivo Black appears exactly once, as the OpenMarket wordmark. Tabular numerals
are on globally (set on `html`), so every figure aligns.

### Hierarchy
Six roles at a ~1.2 ratio: 11 / 13 / 15 / 18 / 22 / 28px. Every figure in Roboto Condensed 700 (`--font-num`), every label in Roboto Condensed 700 caps, every sentence in Noto Sans.
- **Brand** (400, 1.5rem, lh 1, -0.02em): the wordmark in the top bar. Nowhere else.
- **Figure** (`--font-size-xl` 1.375rem, condensed 700): page `h1` and the figures row on a name page (consensus, dispersion, families, latest filing, last print); steps down to `--font-size-lg` at phone width.
- **Section title** (`--font-size-lg` 1.125rem): section `h2`s. The `--font-size-2xl` step (1.75rem) is unused on the index pages.
- **Body** (`--font-size-md` 0.9375rem, lh 1.5): default copy. Explanatory paragraphs cap at 80ch.
- **Detail** (`--font-size-sm` 0.8125rem): table cell values, notes, figure notes, controls.
- **Label** (`--font-size-xs` 0.6875rem, uppercase, 0.05em tracking): table heads, figure labels, chart ticks, tags, versions, footer disclosure. Section heads and nav widen tracking to 0.08–0.1em.

### Named Rules
**The Caps Voice Rule.** Every structural label — table header, module tab, nav link, stamp, button, disclosure — is bold Roboto Condensed uppercase with at least 0.05em tracking. Content (names, sentences, numbers) is never uppercased.

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is global. Any new number-bearing surface inherits it; never opt out.

**The Figure Precision Rule.** A per-share mark is written with cents ($777.53), and with four decimals below a dollar ($0.4512) (`formatPerShare`); the API keeps the full value. Valuations and offering sizes are reported figures, written the short way ($965B, $12.2M, `formatValuation`). Dispersion is a percent to one decimal, and a nonzero figure under 0.05% shows as <0.1%.

**The Fixed Ramp Rule.** Type sizes are fixed steps from the token ramp (0.6875 / 0.8125 / 0.9375 / 1.125 / 1.375 / 1.75rem, plus `--font-size-micro` 0.5625rem for seal caps only); no component declares a literal `font-size`; responsive changes swap steps at breakpoints, never fluid `clamp()` type. (The one sanctioned clamp is the page gutter, which is space, not type.)

**The Baseline Rule (rows).** Wherever a tab, a label, a caption, a figure, or a trailing control shares a row with other text, the row aligns by `align-items: baseline`, never by box center: every section title row, the chart legend, the versions line, a details summary. Mixed fonts and sizes centered by box land on different lines; baselines land on one. Box centering is reserved for rows of controls or icons with no shared text line.

**The Row Rule.** Rows sit on the 4px grid via three tokens: `--row-compact` 2rem (table heads, list entries), `--row-table` 2.5rem (data tables), `--row-board` 4rem (reserved). Controls are `--control-height` 2.25rem, small 2rem, large 2.75rem.

## Layout

A full-width work area under a slim sticky top bar, gutter-padded with
`--page-gutter: clamp(0.75rem, 2vw, 1.25rem)` and capped at `--content-max`
(96rem). The shell is a column: sticky header (4rem, white, 1px Press Ink
bottom rule), main region, and a footer band (1px Rule Gray top rule) holding a
tabular copyright line, a centered bold-caps disclosure, and caps links.

- **Daily page (`/`):** a header (section head, `h1`, the lede, the lag, the versions), then two boards: names with a consensus (highest dispersion first) and names without one, with the reason. Under 58rem each board row stacks into caps labels over values (the `thead` goes visually hidden, `data-label` pseudo-content supplies the labels); the name heads its card.
- **Name page (`/n/[slug]`):** the header, the figures row, the lag and any ruled notes (listed, no filer marks), then sections: marks by security (the headline label open, the others as details), marks outside the series, prints, structure, SPV vehicles, data. Charts cap at 64rem; tables span the content width.
- **Documents (`/methodology`, `/rulebook`, `/resolution-sources`, `/ref`):** prose at 80ch through `components/document`.
- **Phone width:** tables keep a 40rem minimum and scroll inside their own box; a chart keeps a 36rem minimum and opens scrolled to its right end (latest marks, value axis on the right); the page never scrolls sideways.
- **Spacing:** the 8-step rem scale (0.25 → 4rem); sections sit `--space-6` apart, cell padding is `--space-3` (0.75rem), control height is a uniform 2.25rem.

**The Real Density Rule.** Density comes from real content only. No invented rows, placeholder names, or filler stats; where a number cannot be computed from rows, the page says what is missing and why, in the place the number would be.

## Elevation & Depth

Flat. Depth is drawn with hairline rules and pale washes, never cast with
shadows: modules are white boxes outlined in Rule Gray, interiors divided by
Rule Faint, and "raised" surfaces get at most the #fafafa tint. The only
box-shadow in the world is functional, not material: the focus halo
(`0 0 0 0.1875rem #f5b5b5`).

**The No-Resting-Shadow Rule.** Nothing casts a shadow at rest. The focus ring is the only shadow; modules, buttons, and popovers are bounded by rules alone.

## Shapes

The world is square: `--radius-sm/md/lg` are all 0. Buttons, inputs, tables,
tags, stamps, and modules are hard rectangles. Chart dots are circles: marks,
not shapes. The single sanctioned
curve is `--radius-chip` (0.25rem) on company-logo chips, whose slight
rounding sets trademarked marks apart from the system's own geometry. Stamps
use a heavier 1.5px outline to read as inked impressions;
everything else rules at 1px. Icons, when a screen needs one, are drawn in-house at a single 1.5px
round-capped stroke — no icon fonts, no third-party glyph sets.

**The One Curve Rule.** Radius exists only on logo chips (4px). Any other rounded corner is a defect.

## Components

### Buttons
- **Shape:** hard rectangle (0 radius), uniform 2.25rem min-height, bold condensed caps at 0.8125rem with 0.05em tracking (composed from `src/styles/shared.module.css` `.buttonBase`).
- **Primary:** Utility Red fill, white text, 1px matching border (#d70909 → #b40707 on hover). No index page has a primary action today.
- **States:** `:active` nudges down 1px; disabled drops to 48% opacity with `not-allowed`; `:focus-visible` gets the pale-red halo ring.

### Section Head
Ink Roboto Condensed 700 caps at `--font-size-sm`, 0.09em tracking, line-height 1, behind a 0.25rem × 0.75rem Utility Red tick (`.sectionHead` in `src/styles/shared.module.css`). Names a page's crumb ("Marks index") and its quieter sections (Data, Policy).

**The One Plate Rule.** A page carries at most one solid red plate: the active nav link. The module tab (`.moduleTab`) is kept in the shared primitives for a module you act in; no index page has one.

### Figures Row (name page)
One ruled row, 2px Press Ink top rule over a Rule Gray box, of figure cells divided by Rule Faint hairlines: a caps label, the figure in condensed 700 at `--font-size-xl` (the consensus in red), and a muted note. Consensus (label and as-of date), dispersion (the high and low family, each mark linked to its filing), families (live marks, in a series, and outside it), latest filing (linked to the document), last print (post-money linked to its source, round and date, per-share price or why there is none). Every figure links to its date or its document. Cells fill a responsive grid; two per row under 42rem.

### Boards (daily page)
Data tables, one row per name: the name (row header, linked to its page) with its listing when listed, the security and as-of date, the consensus in red, dispersion, families, latest filing with the as-of date, last print. Each figure links to the name page's date. The second board lists names without a consensus: the reason in one sentence from the API, the last print, the SPV vehicle count.

### Mark Chart (name page, signature)
Plain SVG drawn on the server (`src/components/index/mark-chart.tsx`), one per security label, 720 × 280 in a Rule Gray box. Every family mark is a 4px Ink Muted dot that links its filing (a transparent 8px stroke is the hit area; hover turns it red; its `<title>` names the family, date, mark and accession). The consensus is a red point at each as-of date with three or more families, never joined by a line (a line would draw values no filer published); that date's range of family marks is a Red Wash band behind it. The last print is a 1px dashed ink line at its announcement date with a caps label (round, post-money, date), and a horizontal dashed line at its per-share price when a certificate gives one. Value axis on the right, recessive Rule Faint grid, condensed tick labels; log scale when the range is threefold or more, said in the legend. A legend sits above; a caption below states the chart in a sentence (first and last consensus, the latest dispersion, how many marks are drawn). The consensus table and the family-mark table are its table view. Nothing is interpolated.

### Data Tables
Rule Gray box, Paper Hover caps heads at `--row-compact`, Rule Faint row separators, figures right-aligned in condensed 700, dates and accessions in condensed regular. A group row (one as-of date of family marks) is a full-width sentence row that an anchor can target (`:target` washes it Red Wash). Tables scroll inside their own box below their minimum width.

### Ruled Notes
What the page cannot say, in the place the number would be: a hairline box with a 2px Caution Ochre left rule, a caps ochre head (NO FILER MARKS, NOT TRANSCRIBED, NO UNIT QUOTES, LISTED, COMMON-EQUIVALENT) and one or two sentences that cite the file or the rule behind them. Never an apology, never a placeholder figure.

### Details
A collapsible module: Rule Gray box, a summary row (`+` / `−` in condensed 700, the title in body bold, muted facts on the same baseline), the body ruled off beneath. Used for non-headline labels, earlier dates, revisions, each group of marks outside the series, the issuer's own Form D offerings, earlier SPV vehicles and a correction's diff. An anchor into a closed details opens it.

### Tags and Versions
A tag is a hairline-boxed muted caps word (HEADLINE, IN CONSENSUS, NOT COMPARED, LISTED-STOCK MARK, a correction's kind). The versions line (`components/index/versions.tsx`) lists methodology, CE, rulebook, families and the computed time in caps labels over condensed figures, on every page that shows a figure.

### Hanko Seals (status)
A 2.5rem double-ringed circle pressed at −8° (`.seal` in `shared.module.css`). Kept in the primitives; no index page uses one today.

### Spec Tables
The 商品情報 convention for key facts: a hairline-boxed `dl` whose label cells are Paper Hover gray with caps labels and value cells white with right-aligned condensed figures. The rulebook's versions use it.

### Navigation
Caps links (Roboto Condensed 700, 0.9375rem, 0.08em tracking) in the top bar: Index, Methodology, Rulebook, API, Corrections. Hover washes Red Wash; the active route is a solid Utility Red block with white text (hover #b40707); a name page lights Index. At phone width the links become a strip that scrolls sideways and keeps the current one in view. The footer carries the copyright, the disclosure ("Built only from public filings.") and a caps link to the resolution sources. A skip link drops in from the top-left as an ink-filled block on focus.

### Loading, Empty, and Error States
Pages render on the server from the database, so there is no client loading state. An unknown name is a 404. An empty section says what is missing and why (a Ruled Note or a muted sentence); a date no family reported is simply absent from the series, never filled.

v1's components (the trade ticket, implied ladder, market board, quote band, distribution, activity tape, comments, index strip, tab strip and mobile trade sheet) are archived with v1 at `archive/dealer-v1` (`git show archive/dealer-v1:DESIGN.md`).

### Motion (system-wide)
Two durations only — `--duration-fast` 150ms and `--duration-standard` 220ms — on one curve, `cubic-bezier(0.16, 1, 0.3, 1)` ease-out. Sanctioned movements: background/border/color transitions and the 1px button press. `prefers-reduced-motion` disables all of it, globally and per-module. No entrances, parallax, bouncing, or infinite decorative motion.

## Do's and Don'ts

### Do:
- **Do** box every module edge to edge with a 1px Rule Gray border and divide interiors with Rule Faint hairlines.
- **Do** give every structural label the caps voice: Roboto Condensed 700, uppercase, ≥0.05em tracking.
- **Do** triple-encode movement — color, drawn arrow, word — and set all figures in tabular numerals.
- **Do** keep every control at the shared 2.25rem height with the 0.1875rem pale-red focus halo on `:focus-visible`.
- **Do** hold WCAG 2.2 AA: visible focus rings, semantic tables and lists, a text summary and a table view for every chart (per PRODUCT.md).
- **Do** link every figure to the document it came from, or to the section that does.
- **Do** honor `prefers-reduced-motion` in every module that animates, on top of the global kill switch.

### Don't:
- **Don't** introduce a dark mode, extra decorative accent hues, or gradients — the world is light-only with red as its primary accent; green and ochre have narrow semantic roles.
- **Don't** use red or green decoratively, or use color as the only carrier of movement, status, or selection.
- **Don't** round corners (except the 4px logo chip) or cast resting shadows — depth is drawn with rules.
- **Don't** import icon fonts or third-party glyph sets; draw icons at the single 1.5px round-capped stroke.
- **Don't** fabricate density: no invented rows, filler names, or decorative stats; say what is missing instead.
- **Don't** scale type fluidly; swap fixed ramp steps at structural breakpoints.
