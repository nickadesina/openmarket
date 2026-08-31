# OpenMarket Design System

## Theme

A midnight research desk: neutral graphite architecture, measured violet selection, crisp probability typography, and quiet semantic signals. The interface is dense but never cramped. Color communicates selection and state, not excitement.

## Color Palette

Use OKLCH custom properties exclusively.

- Background: `oklch(0.105 0 0)`
- Surface: `oklch(0.145 0.006 285)`
- Elevated surface: `oklch(0.185 0.008 285)`
- Border: `oklch(0.285 0.010 285)`
- Ink: `oklch(0.955 0.006 285)`
- Muted ink: `oklch(0.700 0.014 285)`
- Primary: `oklch(0.650 0.145 290)`
- Primary hover: `oklch(0.700 0.155 290)`
- Accent: `oklch(0.790 0.115 205)`
- Positive: `oklch(0.760 0.135 155)`
- Negative: `oklch(0.700 0.170 25)`
- Warning: `oklch(0.810 0.125 80)`

White or near-white text belongs on saturated primary and negative fills. Pale status fills use dark neutral text. Every semantic state includes a textual or icon cue.

## Typography

Use one product sans stack: `Inter`, `SF Pro Text`, `Segoe UI`, system-ui, sans-serif. Use tabular numerals for market values, probabilities, cash, quantities, times, and chart axes. Headings use restrained fixed sizes and moderate weight contrast. Labels may use concise uppercase only when four words or fewer. Body copy stays within 65–75 characters per line.

## Layout

- Global shell: compact top navigation, full-width work area, consistent horizontal gutters.
- Home: market board paired with global activity, no invented content.
- Desktop market: chart and ladder in the main region, persistent 320–360px trade rail, lower disclosure region.
- Mobile market: single column; selected strike opens an accessible bottom sheet.
- Portfolio: summary band, decomposed positions, residual exposure, and paginated history.
- Admin: narrow operational form with explicit irreversible-action confirmation.

Responsive changes are structural. Typography does not scale fluidly.

## Components

Controls share one height, radius, border, focus ring, and disabled vocabulary. Cards are used only for grouped market entities; chart, ladder, and ticket regions use borders and surface shifts instead of nested cards. Loading uses layout-matched skeletons. Errors are inline with a retry action. Empty states teach the next action.

## Motion

State transitions last 150–250ms with ease-out curves. Price movement may flash briefly with an arrow and text cue. No decorative entrances, bouncing, or infinite motion. Reduced motion disables flashes, sheet transitions, and nonessential interpolation.

## Accessibility

WCAG 2.2 AA minimum. Visible `:focus-visible` rings, keyboard-operable ticket controls, semantic tables/lists, textual chart summaries, focus-trapped mobile sheets, and no color-only movement or position meaning.
