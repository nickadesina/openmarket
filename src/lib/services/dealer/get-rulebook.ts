import { MODEL_VERSION } from "../../config/dealer.js";
import { RULEBOOK, RULEBOOK_VERSION } from "../../engine/dealer/rulebook.js";

export interface RulebookPayload {
  readonly rulebook_version: string;
  readonly model_version: string;
  readonly as_of: string;
  readonly rulebook: typeof RULEBOOK;
}

/** The published settlement rulebook (README D13), carrying the versions every payload does. */
export function getRulebook(now: Date): RulebookPayload {
  return {
    rulebook_version: RULEBOOK_VERSION,
    model_version: MODEL_VERSION,
    as_of: now.toISOString(),
    rulebook: RULEBOOK,
  };
}
