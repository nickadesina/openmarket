import type { Kysely } from "kysely";

import { DEALER_PARAMS } from "../../config/dealer.js";
import type {
  BinaryEventKind,
  Database,
  InstrumentKind,
  InstrumentState,
  ListingTier,
} from "../../db/schema.js";
import { binaryLossBoundUsd } from "../../engine/dealer/binary.js";
import { BLEND_SCHEDULE, type BlendSchedule } from "../../engine/dealer/blend.js";
import { LIVE_STATES } from "./dealer-books.js";
import { centsToUsd, type RefEnvelope, refEnvelope } from "./ref-common.js";

/**
 * GET /api/ref/listings (TECHNICAL_DESIGN.md §8): every listed name with its
 * tier, its live instruments, the versioned parameters it quotes under and
 * its forward's T, beside the blend schedule the references follow.
 */

export interface RefListingParameters {
  readonly kappa: number;
  readonly cap_usd: number;
  readonly b_usd: number;
  readonly spread_floor: number;
  readonly gamma: number;
  readonly p_floor: number;
  readonly sigma_tier: number;
  readonly flag_spread_mult: number;
  readonly flag_cap_mult: number;
  readonly flag_hours: number;
  /** Q·κ: the most the dealer can lose on one forward settlement. */
  readonly forward_loss_bound_usd: number;
  /** b·ln(1/p_floor): the most the dealer can lose on one binary quarter. */
  readonly binary_loss_bound_usd: number;
}

export interface RefListingInstrument {
  readonly id: string;
  readonly kind: InstrumentKind;
  readonly epoch: number;
  readonly question: string;
  readonly state: InstrumentState;
  readonly opens_at: Date;
  readonly expires_at: Date;
  readonly widened_until: Date | null;
}

export interface RefListingSummary {
  readonly slug: string;
  readonly name: string;
  readonly tier: ListingTier;
  readonly binary_event: BinaryEventKind;
  readonly listed_at: Date;
  /** The model version the listing's parameters were written under. */
  readonly listing_model_version: string;
  readonly forward_t_days: number;
  readonly parameters: RefListingParameters;
  readonly anchor: {
    readonly round: string;
    readonly date: string;
    readonly post_money_usd: number;
    readonly source_url: string;
    readonly source_rank: number | null;
  };
  readonly instruments: readonly RefListingInstrument[];
}

export interface RefListingsPayload extends RefEnvelope {
  readonly blend: BlendSchedule;
  readonly listings: readonly RefListingSummary[];
}

export async function getRefListings(db: Kysely<Database>, now: Date): Promise<RefListingsPayload> {
  const listings = await db
    .selectFrom("listings")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .selectAll("listings")
    .select(["companies.name as company_name", "companies.slug as company_slug"])
    .where("listings.delisted_at", "is", null)
    .where("listings.listed_at", "<=", now)
    .orderBy("companies.name")
    .execute();
  const instruments =
    listings.length === 0
      ? []
      : await db
          .selectFrom("instruments")
          .select([
            "id",
            "listing_id",
            "kind",
            "epoch",
            "question",
            "state",
            "opens_at",
            "expires_at",
            "widened_until",
          ])
          .where(
            "listing_id",
            "in",
            listings.map((listing) => listing.id),
          )
          .where("state", "in", LIVE_STATES)
          .orderBy("kind")
          .execute();

  const { dealer } = DEALER_PARAMS;
  return {
    ...refEnvelope(now),
    blend: BLEND_SCHEDULE,
    listings: listings.map((listing) => {
      const capUsd = centsToUsd(listing.cap_cents);
      const bUsd = centsToUsd(listing.b_cents);
      return {
        slug: listing.company_slug,
        name: listing.company_name,
        tier: listing.tier,
        binary_event: listing.binary_event,
        listed_at: listing.listed_at,
        listing_model_version: listing.model_version,
        forward_t_days: listing.forward_t_days,
        parameters: {
          kappa: listing.kappa,
          cap_usd: capUsd,
          b_usd: bUsd,
          spread_floor: listing.spread_floor,
          gamma: listing.gamma,
          p_floor: listing.p_floor,
          sigma_tier: DEALER_PARAMS.sigma_tier[listing.tier],
          flag_spread_mult: dealer.flag_spread_mult,
          flag_cap_mult: dealer.flag_cap_mult,
          flag_hours: dealer.flag_hours,
          forward_loss_bound_usd: capUsd * listing.kappa,
          binary_loss_bound_usd: binaryLossBoundUsd(bUsd, listing.p_floor),
        },
        anchor: {
          round: listing.anchor_round,
          date: listing.anchor_date,
          post_money_usd: Number(listing.anchor_post_money_usd),
          source_url: listing.anchor_source_url,
          source_rank: listing.anchor_source_rank,
        },
        instruments: instruments
          .filter((instrument) => instrument.listing_id === listing.id)
          .map(({ listing_id: _listing, ...instrument }) => instrument),
      };
    }),
  };
}
