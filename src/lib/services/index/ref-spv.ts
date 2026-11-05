/**
 * `GET /api/ref/[slug]/spv`: the name's SPV panel as the name index computes
 * it (METHODOLOGY.md, "SPV premium"): the vehicles matched to it from Form D
 * and the public unit quotes with their premiums against the headline
 * label's consensus.
 */
import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import type { NameIndex } from "./get-name-index.js";
import { envelopeOf, type RefEnvelope } from "./ref-envelope.js";
import { getRefName, type RefNameOptions } from "./ref-name.js";

export interface RefSpvPayload extends RefEnvelope {
  readonly families_version: string;
  readonly issuer: { readonly slug: string; readonly name: string };
  /** The label and quarter a premium is computed against; null without a per-share series. */
  readonly headline: NameIndex["headline"];
  readonly vehicles: NameIndex["spv"]["vehicles"];
  readonly quotes: NameIndex["spv"]["quotes"];
}

export async function getRefSpv(
  db: Kysely<Database>,
  slug: string,
  options: RefNameOptions,
): Promise<RefSpvPayload> {
  const index = await getRefName(db, slug, options);
  return {
    ...envelopeOf(index),
    families_version: index.families_version,
    issuer: { slug: index.issuer.slug, name: index.issuer.name },
    headline: index.headline,
    vehicles: index.spv.vehicles,
    quotes: index.spv.quotes,
  };
}
