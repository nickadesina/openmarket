/** The 41-bucket valuation grid v1: the read-only implied distribution lays its masses on it. */
export const VALUATION_GRID_VERSION = "valuation-v1" as const;

const FIRST_BOUNDARY_EXPONENT = -32;
const LAST_BOUNDARY_EXPONENT = 7;
const GRID_ANCHOR_USD = 1_000_000_000_000;

export const VALUATION_BOUNDARIES_USD: readonly number[] = Object.freeze(
  Array.from(
    { length: LAST_BOUNDARY_EXPONENT - FIRST_BOUNDARY_EXPONENT + 1 },
    (_, index) => GRID_ANCHOR_USD * 2 ** ((FIRST_BOUNDARY_EXPONENT + index) / 2),
  ),
);

export const VALUATION_BUCKET_COUNT = VALUATION_BOUNDARIES_USD.length + 1;
