/**
 * `GET /api/ref/[slug]/revisions`: every family revision on the name, across
 * labels, oldest first, as the name index computes them (METHODOLOGY.md,
 * "Revisions"), with the two constants the rule reads.
 */
import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import { METHODOLOGY } from "../../engine/index/methodology.js";
import type { RevisionPayload } from "./get-name-index.js";
import { envelopeOf, type RefEnvelope } from "./ref-envelope.js";
import { getRefName, type RefNameOptions } from "./ref-name.js";

export interface RefRevision extends RevisionPayload {
  readonly security_label: string;
}

export interface RefRevisionsPayload extends RefEnvelope {
  readonly families_version: string;
  readonly issuer: { readonly slug: string; readonly name: string };
  readonly rule: {
    readonly revision_threshold_ln: number;
    readonly leader_window_days: number;
  };
  readonly revisions: readonly RefRevision[];
}

export async function getRefRevisions(
  db: Kysely<Database>,
  slug: string,
  options: RefNameOptions,
): Promise<RefRevisionsPayload> {
  const index = await getRefName(db, slug, options);
  const revisions = index.labels
    .flatMap((label) =>
      label.revisions.map((revision) => ({ security_label: label.security_label, ...revision })),
    )
    .sort(
      (a, b) =>
        a.to_as_of.localeCompare(b.to_as_of) ||
        a.security_label.localeCompare(b.security_label) ||
        a.family_slug.localeCompare(b.family_slug),
    );
  return {
    ...envelopeOf(index),
    families_version: index.families_version,
    issuer: { slug: index.issuer.slug, name: index.issuer.name },
    rule: {
      revision_threshold_ln: METHODOLOGY.revision_threshold_ln,
      leader_window_days: METHODOLOGY.leader_window_days,
    },
    revisions,
  };
}
