/**
 * Two rules the name pages and the daily page read (METHODOLOGY.md, "Listed
 * names" and "Headline label").
 *
 * A listed name: once an issuer's final IPO prospectus is on EDGAR, a fund's
 * mark on its stock as of that date or later is a mark on listed stock, set
 * from the market, not a private mark. Such marks are published with the
 * filer's other marks but enter no per-share series. Marks before the
 * listing date stay what they were.
 *
 * The headline label: a name's daily figure is the consensus on the label
 * with the most families in the latest quarter that has any consensus; ties
 * go to the label with the higher consensus, then to the label's name.
 */
import type { ConsensusPoint } from "./consensus.js";
import { assertIsoDate, compareText, type IsoDate } from "./mark.js";

/** Whether a mark as of `asOf` is a private mark, given the issuer's listing date (null while private). */
export function isPrivateMark(asOf: IsoDate, listedOn: IsoDate | null): boolean {
  assertIsoDate(asOf, "asOf");
  if (listedOn === null) return true;
  assertIsoDate(listedOn, "listedOn");
  return asOf < listedOn;
}

/** The headline point among a name's consensus points, or null when it has none. */
export function headlinePoint(points: readonly ConsensusPoint[]): ConsensusPoint | null {
  if (points.length === 0) return null;
  const latest = points.reduce(
    (quarter, point) => (point.quarter > quarter ? point.quarter : quarter),
    points[0]!.quarter,
  );
  return (
    [...points]
      .filter((point) => point.quarter === latest)
      .sort(
        (left, right) =>
          right.nFamilies - left.nFamilies ||
          right.consensusUsd - left.consensusUsd ||
          compareText(left.securityLabel, right.securityLabel),
      )[0] ?? null
  );
}
