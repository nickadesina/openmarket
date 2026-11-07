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
 * with the most families on the latest as-of date that has any consensus
 * (at least `min_families_for_consensus` families on one label); ties go to
 * the label with the higher consensus, then to the label's name. A name
 * with no such date has no headline.
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

/** The headline point among a name's consensus points, or null when none has a consensus. */
export function headlinePoint(points: readonly ConsensusPoint[]): ConsensusPoint | null {
  const priced = points.filter((point) => point.consensusUsd !== null);
  if (priced.length === 0) return null;
  const latest = priced.reduce(
    (asOf, point) => (point.asOf > asOf ? point.asOf : asOf),
    priced[0]!.asOf,
  );
  return (
    priced
      .filter((point) => point.asOf === latest)
      .sort(
        (left, right) =>
          right.nFamilies - left.nFamilies ||
          right.consensusUsd! - left.consensusUsd! ||
          compareText(left.securityLabel, right.securityLabel),
      )[0] ?? null
  );
}
