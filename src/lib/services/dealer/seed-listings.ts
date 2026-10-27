import type { Kysely, Transaction } from "kysely";

import { ServiceError } from "../../api/errors.js";
import { DEALER_PARAMS, type DealerParams, MODEL_VERSION } from "../../config/dealer.js";
import type { ListingAnchor } from "../../config/listing-anchors.js";
import type {
  BinaryEventKind,
  CompanyRow,
  Database,
  ListingInsert,
  ListingRow,
} from "../../db/schema.js";

/** The labs' binary is "public S-1 filed by quarter-end" (README D11). */
export const PUBLIC_S1_COMPANIES: ReadonlySet<string> = new Set(["OpenAI", "Anthropic"]);

export type SeedListingOutcome = "created" | "relisted" | "unchanged";

export interface SeedListingsInput {
  readonly listedAt: Date;
  /** Delist a different active listing for the name instead of refusing. */
  readonly relist: boolean;
  /** One per listed name, from `listingAnchors`. */
  readonly anchors: readonly ListingAnchor[];
}

export interface SeedListingResult {
  readonly company: CompanyRow;
  readonly listing: ListingRow;
  readonly outcome: SeedListingOutcome;
  /** The listing a relist closed. */
  readonly delisted: ListingRow | null;
}

interface PlannedListing {
  readonly name: string;
  readonly slug: string;
  readonly logoPath: string;
  readonly values: Omit<ListingInsert, "company_id">;
}

function refuse(message: string, details: Record<string, unknown> = {}): never {
  throw new ServiceError("INVALID_INPUT", message, details);
}

function dollarsToCents(usd: number): string {
  const cents = Math.round(usd * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) refuse(`${usd} is not a positive dollar amount`);
  return String(cents);
}

/**
 * Each listing's row, entirely from the anchor and params.json. Refuses the
 * whole set when any name lacks a sourced anchor, before anything is written.
 */
export function planListings(
  input: SeedListingsInput,
  params: DealerParams = DEALER_PARAMS,
  modelVersion: string = MODEL_VERSION,
): PlannedListing[] {
  if (Number.isNaN(input.listedAt.getTime())) refuse("listed_at must be a timestamp");
  const names = Object.keys(params.forward_t_days);
  const byCompany = new Map(input.anchors.map((anchor) => [anchor.company, anchor]));
  if (byCompany.size !== input.anchors.length || names.some((name) => !byCompany.has(name))) {
    refuse(`Listing needs exactly one anchor for each of ${names.join(", ")}`);
  }
  const unsourced = names.filter((name) => byCompany.get(name)!.source === null);
  if (unsourced.length > 0) {
    refuse(`Refusing to list: no source_url for the anchor of ${unsourced.join(", ")}`, {
      companies: unsourced,
    });
  }

  return names.map((name) => {
    const anchor = byCompany.get(name)!;
    const source = anchor.source!;
    if (Date.parse(`${anchor.announcementDate}T00:00:00Z`) > input.listedAt.getTime()) {
      refuse(`${name}: listed_at precedes the anchor round (${anchor.announcementDate})`);
    }
    const slug = name.toLowerCase().replaceAll(" ", "-");
    const binaryEvent: BinaryEventKind = PUBLIC_S1_COMPANIES.has(name)
      ? "public_s1"
      : "priced_round";
    const dealer = params.dealer;
    return {
      name,
      slug,
      logoPath: `/logos/${slug}.svg`,
      values: {
        tier: Number(anchor.postMoneyUsd) >= params.tier.mega_threshold_usd ? "mega" : "redhot",
        binary_event: binaryEvent,
        kappa: dealer.kappa,
        cap_cents: dollarsToCents(dealer.cap_usd),
        b_cents: dollarsToCents(dealer.b_usd),
        spread_floor: dealer.s_floor,
        gamma: dealer.gamma,
        p_floor: dealer.p_floor,
        forward_t_days: params.forward_t_days[name]!,
        model_version: modelVersion,
        anchor_round: anchor.roundName,
        anchor_date: anchor.announcementDate,
        anchor_post_money_usd: Number(anchor.postMoneyUsd).toFixed(2),
        anchor_source_url: source.url,
        anchor_source_rank: source.rank,
        listed_at: input.listedAt,
        delisted_at: null,
      },
    };
  });
}

function sameTerms(listing: ListingRow, values: PlannedListing["values"]): boolean {
  return (
    listing.tier === values.tier &&
    listing.binary_event === values.binary_event &&
    listing.kappa === values.kappa &&
    listing.cap_cents === values.cap_cents &&
    listing.b_cents === values.b_cents &&
    listing.spread_floor === values.spread_floor &&
    listing.gamma === values.gamma &&
    listing.p_floor === values.p_floor &&
    listing.forward_t_days === values.forward_t_days &&
    listing.model_version === values.model_version &&
    listing.anchor_round === values.anchor_round &&
    listing.anchor_date === values.anchor_date &&
    listing.anchor_post_money_usd === values.anchor_post_money_usd &&
    listing.anchor_source_url === values.anchor_source_url &&
    listing.anchor_source_rank === values.anchor_source_rank
  );
}

async function companyFor(
  transaction: Transaction<Database>,
  planned: PlannedListing,
): Promise<CompanyRow> {
  // An existing row (Anthropic's ladder company) is reused as it stands.
  await transaction
    .insertInto("companies")
    .values({ name: planned.name, slug: planned.slug, logo_path: planned.logoPath })
    .onConflict((conflict) => conflict.column("slug").doNothing())
    .execute();
  return transaction
    .selectFrom("companies")
    .selectAll()
    .where("slug", "=", planned.slug)
    .executeTakeFirstOrThrow();
}

async function seedOne(
  transaction: Transaction<Database>,
  planned: PlannedListing,
  input: SeedListingsInput,
): Promise<SeedListingResult> {
  const company = await companyFor(transaction, planned);
  const active = await transaction
    .selectFrom("listings")
    .selectAll()
    .where("company_id", "=", company.id)
    .where("delisted_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
  const atListedAt = await transaction
    .selectFrom("listings")
    .selectAll()
    .where("company_id", "=", company.id)
    .where("listed_at", "=", input.listedAt)
    .executeTakeFirst();

  if (atListedAt !== undefined) {
    if (atListedAt.delisted_at !== null) {
      refuse(`${planned.name}: the listing at ${input.listedAt.toISOString()} was delisted`);
    }
    if (sameTerms(atListedAt, planned.values)) {
      return { company, listing: atListedAt, outcome: "unchanged", delisted: null };
    }
    refuse(`${planned.name}: a listing at ${input.listedAt.toISOString()} exists with other terms`);
  }

  let delisted: ListingRow | null = null;
  if (active !== undefined) {
    if (!input.relist) {
      refuse(
        `${planned.name}: listed since ${active.listed_at.toISOString()}; pass --relist to replace it`,
      );
    }
    if (active.listed_at.getTime() >= input.listedAt.getTime()) {
      refuse(`${planned.name}: a relist must be later than the active listing`);
    }
    delisted = await transaction
      .updateTable("listings")
      .set({ delisted_at: input.listedAt })
      .where("id", "=", active.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  const listing = await transaction
    .insertInto("listings")
    .values({ company_id: company.id, ...planned.values })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { company, listing, outcome: delisted === null ? "created" : "relisted", delisted };
}

/**
 * Lists the launch names (README D10) at `listedAt`: one `listings` row each,
 * idempotent on (company, listed_at). All names commit together or none do.
 * Instruments and their books are the dealer job's (milestone 6), not this.
 */
export async function seedListings(
  db: Kysely<Database>,
  input: SeedListingsInput,
): Promise<SeedListingResult[]> {
  const planned = planListings(input);
  return db.transaction().execute(async (transaction) => {
    const results: SeedListingResult[] = [];
    for (const listing of planned) results.push(await seedOne(transaction, listing, input));
    return results;
  });
}
