import { type Kysely, sql } from "kysely";

import type { Database, EventFlagConfidence, EventFlagKind, JsonObject } from "../../db/schema.js";
import {
  afterPosition,
  cursorAfter,
  cursorTime,
  decodeCursor,
  loadRefListing,
  type RefEnvelope,
  refEnvelope,
  takePage,
} from "./ref-common.js";

/**
 * GET /api/ref/[slug]/flags (TECHNICAL_DESIGN.md §8): the public evidence
 * the dealer reads for the name, oldest observation first: every event flag
 * it widens on, prices off or settles against. `user_submitted` evidence is
 * left out until a confirmed flag carries it. Each flag lists the model mids
 * that cite it (as the anchor print or the leak) so the evidence and the
 * forecast log join without guesswork.
 */

const FLAGS_STREAMS = ["flags"] as const;

const DEALER_KINDS: readonly EventFlagKind[] = [
  "form_d",
  "form_d_amend",
  "charter",
  "scoop",
  "release",
  "s1_public",
  "print",
];

export interface RefFlag {
  readonly id: string;
  readonly kind: EventFlagKind;
  readonly source_url: string | null;
  readonly source_rank: number | null;
  readonly observed_at: Date;
  readonly published_at: Date | null;
  readonly terms: JsonObject;
  readonly confidence: EventFlagConfidence;
  readonly dedupe_key: string;
  readonly promoted_from: string | null;
  readonly cited_by_mids: readonly string[];
}

export interface RefFlagsPayload extends RefEnvelope {
  readonly slug: string;
  readonly flags: readonly RefFlag[];
  readonly next_cursor: string | null;
}

async function citations(
  db: Kysely<Database>,
  listingId: string,
  flagIds: readonly string[],
): Promise<Map<string, string[]>> {
  const cited = new Map<string, string[]>();
  if (flagIds.length === 0) return cited;
  const rows = await db
    .selectFrom("model_mids")
    .innerJoin("instruments", "instruments.id", "model_mids.instrument_id")
    .select([
      "model_mids.id",
      sql<string | null>`model_mids.inputs_json -> 'leak' ->> 'flag_id'`.as("leak"),
      sql<string | null>`model_mids.inputs_json -> 'anchor' ->> 'flag_id'`.as("anchor"),
    ])
    .where("instruments.listing_id", "=", listingId)
    .where((eb) =>
      eb.or([
        eb(sql`model_mids.inputs_json -> 'leak' ->> 'flag_id'`, "in", flagIds),
        eb(sql`model_mids.inputs_json -> 'anchor' ->> 'flag_id'`, "in", flagIds),
      ]),
    )
    .orderBy("model_mids.computed_at")
    .orderBy("model_mids.id")
    .execute();
  for (const row of rows) {
    for (const flagId of new Set([row.leak, row.anchor])) {
      if (flagId === null || !flagIds.includes(flagId)) continue;
      cited.set(flagId, [...(cited.get(flagId) ?? []), row.id]);
    }
  }
  return cited;
}

export async function getRefFlags(
  db: Kysely<Database>,
  slug: string,
  query: { readonly cursor?: string; readonly limit: number },
  now: Date,
): Promise<RefFlagsPayload> {
  const listing = await loadRefListing(db, slug);
  const { flags: after } = decodeCursor(query.cursor, FLAGS_STREAMS);
  let flags: RefFlag[] = [];
  let next: Parameters<typeof cursorAfter>[0]["flags"] = "end";
  if (after !== "end") {
    let builder = db
      .selectFrom("event_flags")
      .select([
        "id",
        "kind",
        "source_url",
        "source_rank",
        "observed_at",
        "published_at",
        "terms_json",
        "confidence",
        "dedupe_key",
        "promoted_from",
        cursorTime("observed_at").as("cursor_at"),
      ])
      .where("company_id", "=", listing.company_id)
      .where("kind", "in", DEALER_KINDS)
      .where("observed_at", "<=", now);
    if (after !== null) builder = builder.where(afterPosition("observed_at", "id", after, "uuid"));
    const rows = await builder
      .orderBy("observed_at")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = takePage(rows, query.limit, (row) => ({ at: row.cursor_at, key: row.id }));
    const cited = await citations(
      db,
      listing.id,
      page.items.map((row) => row.id),
    );
    flags = page.items.map(({ cursor_at: _cursor, terms_json, ...row }) => ({
      ...row,
      terms: terms_json,
      cited_by_mids: cited.get(row.id) ?? [],
    }));
    next = page.next;
  }
  return {
    ...refEnvelope(now),
    slug: listing.company.slug,
    flags,
    next_cursor: cursorAfter({ flags: next }),
  };
}
