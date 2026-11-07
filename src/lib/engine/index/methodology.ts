/**
 * Every constant of the index methodology, in one frozen object that
 * `/api/ref/methodology` publishes as is. `METHODOLOGY.md` states each of
 * these and nothing else (tests/engine/index/methodology.test.ts holds the
 * two to each other). Changing a value is a new `methodology_version`, never
 * an edit: 0.x is draft until Nick signs it, 1.0.0 is the first post.
 */
import { SHARE_UNITS } from "./mark.js";
import { CE_BASIS, CE_VERSION } from "./waterfall.js";

export const METHODOLOGY_VERSION = "0.2.0";

export const METHODOLOGY = Object.freeze({
  methodology_version: METHODOLOGY_VERSION,
  /** The common-equivalent conversion's own version (`waterfall.ts`). */
  ce_version: CE_VERSION,
  /** Preferred share counts in the waterfall come from shares authorized. */
  ce_basis: CE_BASIS,
  /** A per-share mark is computed only for holdings counted in these units (N-PORT `NS`, shares). */
  per_share_units: SHARE_UNITS,
  /** A family's change on a label is a revision when |ln(new / old)| is at least this. */
  revision_threshold_ln: 0.005,
  /** A revision's leader is the first family to revise the same way within this many days before. */
  leader_window_days: 180,
  /** A family's funds disagree (`intra_family_split`) when (max − min) / median exceeds this. */
  intra_family_split_tolerance: 0.001,
  /** A consensus is published only with at least this many families on the label on one as-of date. */
  min_families_for_consensus: 3,
  /** Dispersion is published only with at least this many families on the label on one as-of date. */
  min_families_for_dispersion: 3,
} as const);

export type Methodology = typeof METHODOLOGY;
