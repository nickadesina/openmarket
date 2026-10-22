import { type Kysely, sql } from "kysely";

import type {
  Database,
  InstrumentKind,
  InstrumentState,
  JsonValue,
  ListingTier,
  ReferencePriceRow,
} from "../../db/schema.js";
import { type FlagTerms, postMoneyUsd } from "../../engine/dealer/rulebook.js";
import { LIVE_STATES, openForwardInventory } from "./dealer-books.js";
import {
  loadRefListing,
  type RefEnvelope,
  type RefListing,
  refEnvelope,
  signOf,
  usdOfLn,
} from "./ref-common.js";
import { latestReference } from "./reference-prices.js";

/**
 * GET /api/ref/[slug] (README D14, TECHNICAL_DESIGN.md §8): the name's
 * published reference forward (ln USD and dollars) and reference hazard
 * (P(priced round, or public S-1, by the binary's quarter-end)), each with
 * its weights and the components it was blended from; the last print; the
 * next expiry; and the sign of the dealer's forward inventory.
 *
 * `model_only` says when a reference is the model mid itself: no traded flow
 * in the window and no crowd past N_min.
 */

export interface RefPublishedReference {
  readonly instrument_id: string | null;
  readonly as_of: Date;
  readonly blend_version: string;
  readonly model_version: string;
  readonly rulebook_version: string;
  readonly model_only: boolean;
  readonly weights: { readonly model: number; readonly traded: number; readonly crowd: number };
  readonly components: JsonValue;
}

export interface RefForwardReference extends RefPublishedReference {
  readonly ln: number;
  readonly usd: number;
}

export interface RefHazardReference extends RefPublishedReference {
  readonly p: number;
}

export interface RefLiveInstrument {
  readonly id: string;
  readonly kind: InstrumentKind;
  readonly epoch: number;
  readonly state: InstrumentState;
  readonly opens_at: Date;
  readonly expires_at: Date;
  readonly widened_until: Date | null;
  /** The linked tournament question at /t/q/[slug], whose crowd feeds the reference. */
  readonly question_slug: string | null;
}

export interface RefLastPrint {
  readonly round: string | null;
  readonly date: string;
  readonly post_money_usd: number;
  readonly post_money_ln: number;
  readonly source_url: string | null;
  readonly source_rank: number | null;
  /** The `print` flag, when the last print is newer than the listing's anchor round. */
  readonly flag_id: string | null;
}

export interface RefReferencePayload extends RefEnvelope {
  readonly slug: string;
  readonly name: string;
  readonly tier: ListingTier;
  readonly reference_forward: RefForwardReference | null;
  readonly reference_hazard: RefHazardReference | null;
  readonly last_print: RefLastPrint;
  readonly next_expiry: {
    readonly kind: InstrumentKind;
    readonly instrument_id: string;
    readonly expires_at: Date;
  } | null;
  /** +1 the dealer is net long the forward (users net short), −1 net short, 0 flat; null with no live forward. */
  readonly dealer_inventory_sign: -1 | 0 | 1 | null;
  readonly instruments: readonly RefLiveInstrument[];
}

function published(row: ReferencePriceRow): RefPublishedReference {
  const components = row.components_json;
  const instrumentId =
    components !== null &&
    typeof components === "object" &&
    !Array.isArray(components) &&
    typeof components.instrument_id === "string"
      ? components.instrument_id
      : null;
  return {
    instrument_id: instrumentId,
    as_of: row.as_of,
    blend_version: row.blend_version,
    model_version: row.model_version,
    rulebook_version: row.rulebook_version,
    model_only: row.w_traded === 0 && row.w_crowd === 0,
    weights: { model: row.w_model, traded: row.w_traded, crowd: row.w_crowd },
    components,
  };
}

/** The listing's anchor round, or a later print flag with a post-money observed by `now`. */
async function lastPrint(
  db: Kysely<Database>,
  listing: RefListing,
  now: Date,
): Promise<RefLastPrint> {
  const anchorUsd = Number(listing.anchor_post_money_usd);
  let found: RefLastPrint = {
    round: listing.anchor_round,
    date: listing.anchor_date,
    post_money_usd: anchorUsd,
    post_money_ln: Math.log(anchorUsd),
    source_url: listing.anchor_source_url,
    source_rank: listing.anchor_source_rank,
    flag_id: null,
  };
  const prints = await db
    .selectFrom("event_flags")
    .select(["id", "published_at", "observed_at", "source_url", "source_rank", "terms_json"])
    .where("company_id", "=", listing.company_id)
    .where("kind", "=", "print")
    .where("observed_at", "<=", now)
    .orderBy(sql`coalesce(published_at, observed_at)`)
    .orderBy("id")
    .execute();
  for (const print of prints) {
    const day = (print.published_at ?? print.observed_at).toISOString().slice(0, 10);
    const postMoney = postMoneyUsd(print.terms_json as unknown as FlagTerms);
    // A print dated on or before the anchor's day is the anchor round or older.
    if (postMoney === null || day <= listing.anchor_date) continue;
    found = {
      round: null,
      date: day,
      post_money_usd: postMoney,
      post_money_ln: Math.log(postMoney),
      source_url: print.source_url,
      source_rank: print.source_rank,
      flag_id: print.id,
    };
  }
  return found;
}

export async function getRefReference(
  db: Kysely<Database>,
  slug: string,
  now: Date,
): Promise<RefReferencePayload> {
  const listing = await loadRefListing(db, slug);
  const instruments = await db
    .selectFrom("instruments")
    .leftJoin(
      "tournament_instrument_links",
      "tournament_instrument_links.instrument_id",
      "instruments.id",
    )
    .leftJoin(
      "tournament_questions",
      "tournament_questions.id",
      "tournament_instrument_links.question_id",
    )
    .select([
      "instruments.id",
      "instruments.kind",
      "instruments.epoch",
      "instruments.state",
      "instruments.opens_at",
      "instruments.expires_at",
      "instruments.widened_until",
      "tournament_questions.slug as question_slug",
    ])
    .where("instruments.listing_id", "=", listing.id)
    .where("instruments.state", "in", LIVE_STATES)
    .orderBy("instruments.expires_at")
    .orderBy("instruments.kind")
    .execute();
  const forward = instruments.find((instrument) => instrument.kind === "forward");
  const forwardRow = await latestReference(db, listing.id, "forward");
  const hazardRow = await latestReference(db, listing.id, "binary");
  const next = instruments[0];

  return {
    ...refEnvelope(now),
    slug: listing.company.slug,
    name: listing.company.name,
    tier: listing.tier,
    reference_forward:
      forwardRow === undefined
        ? null
        : { ...published(forwardRow), ln: forwardRow.value, usd: usdOfLn(forwardRow.value) },
    reference_hazard:
      hazardRow === undefined ? null : { ...published(hazardRow), p: hazardRow.value },
    last_print: await lastPrint(db, listing, now),
    next_expiry:
      next === undefined
        ? null
        : { kind: next.kind, instrument_id: next.id, expires_at: next.expires_at },
    dealer_inventory_sign:
      forward === undefined
        ? null
        : signOf((await openForwardInventory(db, forward.id)).inventoryCents),
    instruments,
  };
}
