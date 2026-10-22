import { RULEBOOK } from "../../engine/dealer/rulebook.js";
import { type RefEnvelope, refEnvelope } from "./ref-common.js";

export interface RulebookPayload extends RefEnvelope {
  readonly rulebook: typeof RULEBOOK;
}

/** The published settlement rulebook (README D13), carrying the versions every payload does. */
export function getRulebook(now: Date): RulebookPayload {
  return { ...refEnvelope(now), rulebook: RULEBOOK };
}
