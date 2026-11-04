import type { RulebookPayload } from "../services/get-rulebook.js";
import type { RefEnvelope } from "../services/ref-common.js";

/**
 * The /ref docs page's content that is not prose: each route's fields,
 * checked against the payload types so a field added to a payload fails the
 * typecheck until it is documented here.
 *
 * v1's dealer routes (listings, a name's reference price, its history, mids
 * and flags) are archived at the tag archive/dealer-v1; the index's routes
 * replace them (docs/prompts/v2/README.md, P5).
 */

/** One line per field, keyed by the payload type's own keys. */
type FieldDocs<T> = { readonly [K in keyof T]-?: string };

export const ENVELOPE_FIELDS = {
  rulebook_version:
    "The settlement rulebook in force (/rulebook). A changed rule is a new version.",
  as_of: "When the server answered, UTC.",
} as const satisfies FieldDocs<RefEnvelope>;

export interface RouteDoc {
  readonly path: string;
  readonly query: readonly (readonly [string, string])[];
  readonly summary: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly id: string;
}

export const REF_ROUTES: readonly RouteDoc[] = [
  {
    path: "/api/ref/rulebook",
    query: [],
    summary:
      "The settlement rulebook as data, with the rules not yet enforced. In prose at /rulebook.",
    fields: {
      ...ENVELOPE_FIELDS,
      rulebook:
        "The rules: print, announcement, source ranks, revision, the binary's and the forward's.",
      not_built: "Rules that are the contract's intent but not enforced by the code yet.",
    } satisfies FieldDocs<RulebookPayload>,
    id: "rulebook",
  },
];
