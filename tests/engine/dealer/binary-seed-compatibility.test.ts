import { expect, it } from "vitest";
import { seedBinary } from "../../../src/lib/engine/dealer/binary.js";

// Captured from the pre-cleanup seedBinaryMarket, including its 15-digit NO
// rounding and residual centering. Exact equality guards stored ledger seeds.
it.each([
  { p: 0.05, b: 2000, no: 0.95, q: 2944.4389791664403 },
  { p: 0.95, b: 2000, no: 0.05, q: -2944.4389791664403 },
  { p: 0.7, b: 200, no: 0.3, q: -84.72978603872036 },
  { p: 0.123456789012345, b: 1234, no: 0.876543210987655, q: 1209.378488092282 },
  { p: 1e-10, b: 2000, no: 0.9999999999, q: 23025.85092984046 },
  { p: 0.9999999999, b: 2000, no: 1.00000008274037e-10, q: -23025.85084710009 },
])("preserves the binary seed bit-for-bit at p=$p, b=$b", ({ p, b, no, q }) => {
  expect(seedBinary(p, b)).toEqual({ probabilities: [no, p], q: [q, -q], yesProbability: p });
});
