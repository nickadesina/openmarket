/**
 * The envelope every `/api/ref/*` payload opens with (docs/prompts/v2/README.md,
 * "API and pages"): the versions that produced it, when it was computed, and
 * the N-PORT lag in one sentence. The keys come first, in this order, so a
 * payload can be cited from its first line.
 */
import { METHODOLOGY_VERSION } from "../../engine/index/methodology.js";
import { CE_VERSION } from "../../engine/index/waterfall.js";
import { RULEBOOK_VERSION } from "../../engine/rulebook.js";

export interface RefEnvelope {
  readonly methodology_version: string;
  readonly ce_version: string;
  readonly rulebook_version: string;
  /** When this payload was computed, UTC. */
  readonly as_of: string;
  /** The N-PORT lag, stated on every payload as on every page (decision 0003 §5). */
  readonly lag_note: string;
}

/**
 * The lag, as METHODOLOGY.md ("Lag") states it from the filings it cites:
 * nothing here is measured at request time.
 */
export const LAG_NOTE =
  "Filer marks come mostly from Form N-PORT-P, which is public only about 60 days after the month-end it reports (54 to 60 days in the filings METHODOLOGY.md cites), so figures for the latest dates can change as late reports arrive.";

export const ENVELOPE_KEYS = [
  "methodology_version",
  "ce_version",
  "rulebook_version",
  "as_of",
  "lag_note",
] as const satisfies readonly (keyof RefEnvelope)[];

export function refEnvelope(now: Date): RefEnvelope {
  return {
    methodology_version: METHODOLOGY_VERSION,
    ce_version: CE_VERSION,
    rulebook_version: RULEBOOK_VERSION,
    as_of: now.toISOString(),
    lag_note: LAG_NOTE,
  };
}

/** The envelope of a payload already computed, so a slice of it carries the same versions and time. */
export function envelopeOf(payload: RefEnvelope): RefEnvelope {
  return {
    methodology_version: payload.methodology_version,
    ce_version: payload.ce_version,
    rulebook_version: payload.rulebook_version,
    as_of: payload.as_of,
    lag_note: payload.lag_note,
  };
}
