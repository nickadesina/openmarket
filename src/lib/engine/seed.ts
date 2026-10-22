import { seedBinary } from "./dealer/binary.js";

/** Compatibility for the integration harness; production seeds through seedBinary. */
export function seedBinaryMarket(
  yesProbability: number,
  b: number,
): {
  probabilities: number[];
  q: number[];
  currentMetric: number;
} {
  const seeded = seedBinary(yesProbability, b);
  return {
    probabilities: [...seeded.probabilities],
    q: [...seeded.q],
    currentMetric: seeded.yesProbability,
  };
}
