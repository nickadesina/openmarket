import { EPS, type DecomposedPosition } from "./types.js";

interface Candidate extends DecomposedPosition {
  readonly width: number;
  readonly score: number;
}

export function decomposeHoldings(holdings: readonly number[]): {
  positions: DecomposedPosition[];
  residual: number[];
} {
  if (!Array.isArray(holdings) || holdings.length < 2) {
    throw new RangeError("holdings must contain at least two buckets");
  }

  const residual = new Array<number>(holdings.length);
  for (let bucket = 0; bucket < holdings.length; bucket += 1) {
    const holding = holdings[bucket];
    if (holding === undefined || !Number.isFinite(holding)) {
      throw new RangeError("holdings must contain only finite values");
    }
    if (holding < -EPS) {
      throw new RangeError("holdings must not contain negative values");
    }
    residual[bucket] = holding > EPS ? holding : 0;
  }

  const positions: DecomposedPosition[] = [];
  const prefixMinimum = new Array<number>(residual.length);
  const suffixMinimum = new Array<number>(residual.length);

  while (true) {
    prefixMinimum[0] = residual[0]!;
    for (let bucket = 1; bucket < residual.length; bucket += 1) {
      prefixMinimum[bucket] = Math.min(
        prefixMinimum[bucket - 1]!,
        residual[bucket]!,
      );
    }

    const lastBucket = residual.length - 1;
    suffixMinimum[lastBucket] = residual[lastBucket]!;
    for (let bucket = lastBucket - 1; bucket >= 0; bucket -= 1) {
      suffixMinimum[bucket] = Math.min(
        suffixMinimum[bucket + 1]!,
        residual[bucket]!,
      );
    }

    let best: Candidate | undefined;
    for (let strikeIndex = 0; strikeIndex < lastBucket; strikeIndex += 1) {
      const yesWidth = lastBucket - strikeIndex;
      const yesQuantity = suffixMinimum[strikeIndex + 1]!;
      if (yesQuantity > EPS) {
        const candidate: Candidate = {
          side: "yes",
          strikeIndex,
          quantity: yesQuantity,
          width: yesWidth,
          score: yesQuantity * yesWidth,
        };
        if (isBetterCandidate(candidate, best)) {
          best = candidate;
        }
      }

      const noWidth = strikeIndex + 1;
      const noQuantity = prefixMinimum[strikeIndex]!;
      if (noQuantity > EPS) {
        const candidate: Candidate = {
          side: "no",
          strikeIndex,
          quantity: noQuantity,
          width: noWidth,
          score: noQuantity * noWidth,
        };
        if (isBetterCandidate(candidate, best)) {
          best = candidate;
        }
      }
    }

    if (best === undefined) {
      break;
    }

    positions.push({
      side: best.side,
      strikeIndex: best.strikeIndex,
      quantity: best.quantity,
    });

    const firstBucket = best.side === "yes" ? best.strikeIndex + 1 : 0;
    const finalBucket =
      best.side === "yes" ? lastBucket : best.strikeIndex;
    for (let bucket = firstBucket; bucket <= finalBucket; bucket += 1) {
      const updated = residual[bucket]! - best.quantity;
      residual[bucket] = updated > EPS ? updated : 0;
    }
  }

  return { positions, residual };
}

function isBetterCandidate(
  candidate: Candidate,
  current: Candidate | undefined,
): boolean {
  if (current === undefined) {
    return true;
  }
  if (candidate.score !== current.score) {
    return candidate.score > current.score;
  }
  if (candidate.width !== current.width) {
    return candidate.width > current.width;
  }
  if (candidate.strikeIndex !== current.strikeIndex) {
    return candidate.strikeIndex < current.strikeIndex;
  }
  return candidate.side === "yes" && current.side === "no";
}
