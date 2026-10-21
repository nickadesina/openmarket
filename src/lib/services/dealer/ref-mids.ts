import type { Kysely } from "kysely";

import type { Database, InstrumentKind, JsonValue } from "../../db/schema.js";
import {
  afterPosition,
  cursorAfter,
  cursorTime,
  decodeCursor,
  loadRefListing,
  type RefEnvelope,
  refEnvelope,
  takePage,
  usdOfLn,
} from "./ref-common.js";

/**
 * GET /api/ref/[slug]/mids (README D14): the model's forecast log, every
 * `model_mids` row of the name's instruments in every epoch, oldest first
 * and unredacted, with the inputs each was computed from so anyone can
 * re-derive it through prior.ts.
 */

export const MIDS_STREAMS = ["mids"] as const;

export interface RefMid {
  readonly id: string;
  readonly instrument_id: string;
  readonly kind: InstrumentKind;
  readonly epoch: number;
  readonly computed_at: Date;
  readonly model_version: string;
  readonly rulebook_version: string;
  /** A forward's mid; null on a binary. */
  readonly mid_ln: number | null;
  readonly mid_usd: number | null;
  /** A binary's probability; null on a forward. */
  readonly p: number | null;
  readonly inputs: JsonValue;
  readonly run_id: string | null;
}

export interface RefMidsPayload extends RefEnvelope {
  readonly slug: string;
  readonly mids: readonly RefMid[];
  readonly next_cursor: string | null;
}

export async function getRefMids(
  db: Kysely<Database>,
  slug: string,
  query: { readonly cursor?: string; readonly limit: number },
  now: Date,
): Promise<RefMidsPayload> {
  const listing = await loadRefListing(db, slug);
  const { mids: after } = decodeCursor(query.cursor, MIDS_STREAMS);
  let page: ReturnType<typeof takePage<RefMid & { readonly cursor_at: string }>> = {
    items: [],
    next: "end",
  };
  if (after !== "end") {
    let builder = db
      .selectFrom("model_mids")
      .innerJoin("instruments", "instruments.id", "model_mids.instrument_id")
      .select([
        "model_mids.id",
        "model_mids.instrument_id",
        "instruments.kind",
        "instruments.epoch",
        "model_mids.computed_at",
        "model_mids.model_version",
        "model_mids.rulebook_version",
        "model_mids.mid_ln",
        "model_mids.p",
        "model_mids.inputs_json",
        "model_mids.run_id",
        cursorTime("model_mids.computed_at").as("cursor_at"),
      ])
      .where("instruments.listing_id", "=", listing.id)
      .where("model_mids.computed_at", "<=", now);
    if (after !== null) {
      builder = builder.where(
        afterPosition("model_mids.computed_at", "model_mids.id", after, "uuid"),
      );
    }
    const rows = await builder
      .orderBy("model_mids.computed_at")
      .orderBy("model_mids.id")
      .limit(query.limit + 1)
      .execute();
    page = takePage(
      rows.map(({ inputs_json, ...row }) => ({
        ...row,
        mid_usd: row.mid_ln === null ? null : usdOfLn(row.mid_ln),
        inputs: inputs_json,
      })),
      query.limit,
      (row) => ({ at: row.cursor_at, key: row.id }),
    );
  }
  return {
    ...refEnvelope(now),
    slug: listing.company.slug,
    mids: page.items.map(({ cursor_at: _cursor, ...mid }) => mid),
    next_cursor: cursorAfter({ mids: page.next }),
  };
}
