import { NOT_BUILT, RULEBOOK } from "../engine/rulebook.js";
import { type RefEnvelope, refEnvelope } from "./ref-common.js";

export interface RulebookPayload extends RefEnvelope {
  readonly rulebook: typeof RULEBOOK;
  /** Rules that are the contracts' intent but not served by the code yet. */
  readonly not_built: typeof NOT_BUILT;
}

/** The published rulebook (README D13), carrying the versions every payload does. */
export function getRulebook(now: Date): RulebookPayload {
  return { ...refEnvelope(now), rulebook: RULEBOOK, not_built: NOT_BUILT };
}
