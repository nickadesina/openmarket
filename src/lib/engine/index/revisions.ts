/**
 * Revisions: a family's change on a label between consecutive marks, when
 * |ln(new / old)| ≥ `revision_threshold_ln`. The leader of a move is the
 * first other family to revise the same label the same way within the
 * `leader_window_days` before; a revision with no such family leads, and each
 * follower's lag is the days from the leader's revision to its own.
 */
import { validateFamilyMarkPoints } from "./consensus.js";
import type { FamilyMarkPoint } from "./families.js";
import { compareText, daysBetween, type IsoDate } from "./mark.js";
import { METHODOLOGY } from "./methodology.js";
import { isComparableLabel } from "./series.js";

export type RevisionDirection = "up" | "down";

export interface Revision {
  readonly familySlug: string;
  readonly familyName: string;
  readonly securityLabel: string;
  readonly fromAsOf: IsoDate;
  /** The revision's date: the as-of of the new mark. */
  readonly toAsOf: IsoDate;
  readonly fromMarkUsd: number;
  readonly toMarkUsd: number;
  /** ln(to / from); null when either mark is zero (the direction still says which way). */
  readonly ln: number | null;
  readonly direction: RevisionDirection;
  readonly role: "leader" | "follower";
  readonly leaderFamilySlug: string | null;
  readonly leaderAsOf: IsoDate | null;
  /** Days from the leader's revision to this one; null for a leader. */
  readonly lagDays: number | null;
}

type Move = Omit<Revision, "role" | "leaderFamilySlug" | "leaderAsOf" | "lagDays">;

function move(previous: FamilyMarkPoint, next: FamilyMarkPoint): Move | null {
  const from = previous.markPerShareUsd;
  const to = next.markPerShareUsd;
  if (from === to) return null;
  const ln = from > 0 && to > 0 ? Math.log(to / from) : null;
  if (ln !== null && Math.abs(ln) < METHODOLOGY.revision_threshold_ln) return null;
  return {
    familySlug: next.familySlug,
    familyName: next.familyName,
    securityLabel: next.securityLabel,
    fromAsOf: previous.asOf,
    toAsOf: next.asOf,
    fromMarkUsd: from,
    toMarkUsd: to,
    ln,
    direction: to > from ? "up" : "down",
  };
}

/** Every family's moves on every label, before leaders are assigned. */
function familyMoves(marks: readonly FamilyMarkPoint[]): Move[] {
  const series = new Map<string, FamilyMarkPoint[]>();
  for (const mark of marks) {
    if (!isComparableLabel(mark.securityLabel)) continue;
    const key = JSON.stringify([mark.familySlug, mark.securityLabel]);
    const list = series.get(key) ?? [];
    list.push(mark);
    series.set(key, list);
  }
  const moves: Move[] = [];
  for (const list of series.values()) {
    const ordered = [...list].sort((left, right) => compareText(left.asOf, right.asOf));
    for (let index = 1; index < ordered.length; index += 1) {
      const found = move(ordered[index - 1]!, ordered[index]!);
      if (found !== null) moves.push(found);
    }
  }
  return moves;
}

function byDateThenFamily(left: Move, right: Move): number {
  return compareText(left.toAsOf, right.toAsOf) || compareText(left.familySlug, right.familySlug);
}

/**
 * Revisions per family and label, each with its leader and lag. Sorted by
 * label, then date, then family.
 */
export function revisions(marks: readonly FamilyMarkPoint[]): Revision[] {
  validateFamilyMarkPoints(marks);
  const moves = familyMoves(marks).sort(byDateThenFamily);
  const result = moves.map((current): Revision => {
    const leader = moves.find((other) => {
      if (other.familySlug === current.familySlug) return false;
      if (other.securityLabel !== current.securityLabel) return false;
      if (other.direction !== current.direction) return false;
      const lag = daysBetween(other.toAsOf, current.toAsOf);
      return lag > 0 && lag <= METHODOLOGY.leader_window_days;
    });
    if (leader === undefined) {
      return {
        ...current,
        role: "leader",
        leaderFamilySlug: null,
        leaderAsOf: null,
        lagDays: null,
      };
    }
    return {
      ...current,
      role: "follower",
      leaderFamilySlug: leader.familySlug,
      leaderAsOf: leader.toAsOf,
      lagDays: daysBetween(leader.toAsOf, current.toAsOf),
    };
  });
  return result.sort(
    (left, right) =>
      compareText(left.securityLabel, right.securityLabel) || byDateThenFamily(left, right),
  );
}
