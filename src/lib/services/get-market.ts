import { type Kysely, sql, type Transaction } from "kysely";

import { isServiceError, ServiceError } from "../api/errors.js";
import { archiveNow } from "../config/archive.js";
import { DEALER_PARAMS, MODEL_VERSION } from "../config/dealer.js";
import type {
  BinaryEventKind,
  CompanyRow,
  Database,
  InstrumentKind,
  InstrumentState,
  ListingRow,
  ListingTier,
  MarketStatus,
} from "../db/schema.js";
import { VALUATION_BOUNDARIES_USD, VALUATION_GRID_VERSION } from "../engine/buckets.js";
import { RULEBOOK_VERSION } from "../engine/dealer/rulebook.js";
import {
  lognormalBucketProbabilities,
  MIN_BUCKET_PROBABILITY,
  probabilitiesAbove,
} from "../engine/distribution.js";
import { impliedValuationQuantile } from "../engine/median.js";
import { LIVE_STATES } from "./dealer/dealer-books.js";
import {
  type BinaryInstrumentQuote,
  type ForwardInstrumentQuote,
  type InstrumentBook,
  quoteBook,
} from "./dealer/get-instrument-quote.js";
import { openInterestSql } from "./open-interest.js";

/**
 * The read model of one listed name (README D10–D11): its live binary and
 * forward quoted exactly as `GET /api/instruments/[id]/quote` quotes them,
 * the read-only implied distribution from the forward mid, open interest,
 * and every epoch of both contracts by market id. `listMarkets` reads every
 * active listing through `readListing`.
 */

export interface ListingCompany {
  readonly name: string;
  readonly slug: string;
  readonly logoPath: string;
}

export interface ListingAnchor {
  readonly round: string;
  readonly date: string;
  /** The last print, decimal USD as published. */
  readonly postMoneyUsd: string;
  readonly sourceUrl: string;
  readonly sourceRank: number | null;
}

export interface ImpliedStrike {
  readonly strikeIndex: number;
  /** Grid boundary, decimal USD. */
  readonly strikeValueUsd: string;
  /** P(next print > strike) under the implied distribution. */
  readonly probabilityAbove: number;
}

/**
 * A lognormal at the forward mid with σ = params.json → sigma_tier[tier],
 * over the 41-bucket valuation grid, every bucket floored at `floor` (D5).
 * Read-only: nothing trades on it.
 */
export interface ImpliedDistribution {
  readonly gridVersion: typeof VALUATION_GRID_VERSION;
  readonly centerUsd: number;
  readonly sigma: number;
  readonly floor: number;
  readonly pmf: number[];
  readonly strikes: ImpliedStrike[];
  /** Grid quantiles, the same log interpolation the tournament's median uses. */
  readonly band: { readonly p10: number; readonly p50: number; readonly p90: number };
  /** The most likely bucket; a null edge is the grid's open end. */
  readonly mode: {
    readonly fromUsd: string | null;
    readonly toUsd: string | null;
    readonly mass: number;
  };
}

export interface ListingOpenInterest {
  /** Open forward notional, long plus short, dollars; each dollar carries at most κ of payout. */
  readonly forwardNotionalUsd: number;
  /** The binary's maximum payout liability, dollars (D4). */
  readonly binaryUsd: number;
  readonly totalUsd: number;
}

export interface ListingEpoch {
  readonly instrumentId: string;
  readonly marketId: string;
  readonly kind: InstrumentKind;
  readonly epoch: number;
  readonly state: InstrumentState;
  readonly marketStatus: MarketStatus;
  readonly question: string;
  readonly opensAt: string;
  readonly expiresAt: string;
  readonly closedAt: string | null;
}

export interface ListingView {
  readonly listingId: string;
  readonly company: ListingCompany;
  readonly tier: ListingTier;
  readonly binaryEvent: BinaryEventKind;
  readonly forwardTDays: number;
  readonly anchor: ListingAnchor;
  readonly listedAt: string;
  readonly delistedAt: string | null;
  /** The live forward's quote; null while none is live (between expiry and its roll). */
  readonly forward: ForwardInstrumentQuote | null;
  /** The live binary's quote; null while none is live. */
  readonly binary: BinaryInstrumentQuote | null;
  /** Forward mid against the last print: mid / post-money − 1. */
  readonly vsLastRound: number | null;
  readonly distribution: ImpliedDistribution | null;
  readonly openInterest: ListingOpenInterest;
  readonly lastTradeAt: string | null;
  readonly modelVersion: string;
  readonly rulebookVersion: string;
}

export interface ListingDetail extends ListingView {
  /** Every epoch of both contracts, newest first; settled ones stay readable by market id. */
  readonly epochs: ListingEpoch[];
  readonly asOf: string;
}

export interface GetMarketOptions {
  readonly now?: Date;
}

export type ListingWithCompany = ListingRow & {
  readonly company: Pick<CompanyRow, "id" | "name" | "slug" | "logo_path">;
};

function readClock(now: Date | undefined): Date {
  const at = now === undefined ? archiveNow() : new Date(now.getTime());
  if (!Number.isFinite(at.getTime())) {
    throw new ServiceError("INVALID_INPUT", "Read clock must be a valid date.");
  }
  return at;
}

/** The implied distribution centred on a forward mid. */
export function impliedDistribution(centerUsd: number, sigma: number): ImpliedDistribution {
  const pmf = lognormalBucketProbabilities(centerUsd, sigma, VALUATION_BOUNDARIES_USD);
  const above = probabilitiesAbove(pmf);
  let modeIndex = 0;
  pmf.forEach((mass, index) => {
    if (mass > pmf[modeIndex]!) modeIndex = index;
  });
  const edge = (index: number) => VALUATION_BOUNDARIES_USD[index]?.toFixed(2) ?? null;
  return {
    gridVersion: VALUATION_GRID_VERSION,
    centerUsd,
    sigma,
    floor: MIN_BUCKET_PROBABILITY,
    pmf,
    strikes: VALUATION_BOUNDARIES_USD.map((boundary, strikeIndex) => ({
      strikeIndex,
      strikeValueUsd: boundary.toFixed(2),
      probabilityAbove: above[strikeIndex]!,
    })),
    band: {
      p10: impliedValuationQuantile(pmf, VALUATION_BOUNDARIES_USD, 0.1),
      p50: impliedValuationQuantile(pmf, VALUATION_BOUNDARIES_USD, 0.5),
      p90: impliedValuationQuantile(pmf, VALUATION_BOUNDARIES_USD, 0.9),
    },
    mode: {
      fromUsd: modeIndex === 0 ? null : edge(modeIndex - 1),
      toUsd: edge(modeIndex),
      mass: pmf[modeIndex]!,
    },
  };
}

/** The live instrument's quote, or null when it is not trading at `at`. */
async function liveQuote(
  db: Transaction<Database>,
  book: InstrumentBook,
  at: Date,
): Promise<BinaryInstrumentQuote | ForwardInstrumentQuote | null> {
  try {
    return await quoteBook(db, book, at);
  } catch (error) {
    if (isServiceError(error) && error.code === "INSTRUMENT_CLOSED") return null;
    throw error;
  }
}

/** Shared read inputs for the whole board, avoiding one query set per listed name. */
async function loadListingReads(
  db: Transaction<Database>,
  listings: readonly ListingWithCompany[],
) {
  const listingIds = listings.map((listing) => listing.id);
  const companyIds = listings.map((listing) => listing.company_id);
  const live = await db
    .selectFrom("instruments")
    .selectAll()
    .where("listing_id", "in", listingIds)
    .where("state", "in", LIVE_STATES)
    .orderBy("epoch", "desc")
    .execute();
  const instrumentIds = live.map((instrument) => instrument.id);
  const [markets, inventory, lastTrades] = await Promise.all([
    instrumentIds.length === 0
      ? []
      : db
          .selectFrom("markets")
          .selectAll()
          .select(openInterestSql(sql.ref("markets.id")).as("binary_interest"))
          .where("instrument_id", "in", instrumentIds)
          .execute(),
    instrumentIds.length === 0
      ? []
      : db
          .selectFrom("forward_positions")
          .select([
            "instrument_id",
            sql<string>`coalesce(sum(notional_cents) filter (where side = 'long'), 0)::text`.as(
              "long",
            ),
            sql<string>`coalesce(sum(notional_cents) filter (where side = 'short'), 0)::text`.as(
              "short",
            ),
          ])
          .where("instrument_id", "in", instrumentIds)
          .where("settled_at", "is", null)
          .where("voided_at", "is", null)
          .groupBy("instrument_id")
          .execute(),
    db
      .selectFrom("trades")
      .innerJoin("markets", "markets.id", "trades.market_id")
      .select(["markets.company_id", sql<Date>`max(trades.created_at)`.as("at")])
      .where("markets.company_id", "in", companyIds)
      .groupBy("markets.company_id")
      .execute(),
  ]);
  return {
    live,
    markets: new Map(markets.map((market) => [market.instrument_id, market])),
    inventory: new Map(inventory.map((row) => [row.instrument_id, row])),
    lastTrades: new Map(lastTrades.map((row) => [row.company_id, row.at])),
  };
}

/** One listing's view at `at`, using the board's common read snapshot. */
async function readListing(
  db: Transaction<Database>,
  listing: ListingWithCompany,
  at: Date,
  reads: Awaited<ReturnType<typeof loadListingReads>>,
): Promise<ListingView> {
  const live = reads.live.filter(
    (instrument) => instrument.listing_id === listing.id && reads.markets.has(instrument.id),
  );
  const { company: listingCompany, ...listingRow } = listing;
  const company = { id: listingCompany.id, name: listingCompany.name, slug: listingCompany.slug };

  let forward: ForwardInstrumentQuote | null = null;
  let binary: BinaryInstrumentQuote | null = null;
  for (const kind of ["forward", "binary"] as const) {
    const row = live.find((instrument) => instrument.kind === kind);
    if (row === undefined) continue;
    const instrument = row;
    const market = reads.markets.get(row.id);
    if (market === undefined) continue;
    const quote = await liveQuote(db, { instrument, listing: listingRow, company, market }, at);
    if (quote?.kind === "forward") forward = quote;
    if (quote?.kind === "binary") binary = quote;
  }

  const forwardInventory =
    forward === null ? undefined : reads.inventory.get(forward.instrument_id);
  const forwardNotionalUsd =
    forwardInventory === undefined
      ? 0
      : (Number(forwardInventory.long) + Number(forwardInventory.short)) / 100;
  const binaryUsd =
    binary === null ? 0 : (reads.markets.get(binary.instrument_id)?.binary_interest ?? 0);
  const lastTrade = reads.lastTrades.get(listing.company_id);
  const anchorUsd = Number(listing.anchor_post_money_usd);

  return {
    listingId: listing.id,
    company: { name: company.name, slug: company.slug, logoPath: listingCompany.logo_path },
    tier: listing.tier,
    binaryEvent: listing.binary_event,
    forwardTDays: listing.forward_t_days,
    anchor: {
      round: listing.anchor_round,
      date: listing.anchor_date,
      postMoneyUsd: listing.anchor_post_money_usd,
      sourceUrl: listing.anchor_source_url,
      sourceRank: listing.anchor_source_rank,
    },
    listedAt: listing.listed_at.toISOString(),
    delistedAt: listing.delisted_at?.toISOString() ?? null,
    forward,
    binary,
    vsLastRound: forward === null || !(anchorUsd > 0) ? null : forward.mid_usd / anchorUsd - 1,
    distribution:
      forward === null
        ? null
        : impliedDistribution(forward.mid_usd, DEALER_PARAMS.sigma_tier[listing.tier]),
    openInterest: {
      forwardNotionalUsd,
      binaryUsd,
      totalUsd: forwardNotionalUsd + binaryUsd,
    },
    lastTradeAt: lastTrade === undefined ? null : new Date(lastTrade).toISOString(),
    modelVersion: MODEL_VERSION,
    rulebookVersion: RULEBOOK_VERSION,
  };
}

/** Batch the board's listing/book/interest reads; quoteBook remains the authoritative quote calculation. */
export async function readListings(
  db: Transaction<Database>,
  listings: readonly ListingWithCompany[],
  at: Date,
): Promise<ListingView[]> {
  if (listings.length === 0) return [];
  const reads = await loadListingReads(db, listings);
  return Promise.all(listings.map((listing) => readListing(db, listing, at, reads)));
}

/** Listings with their companies: `active` ones (listed by `at`, not delisted), or a company's latest. */
export async function loadListings(
  db: Transaction<Database>,
  filter: { readonly active: Date } | { readonly slug: string },
): Promise<ListingWithCompany[]> {
  let query = db
    .selectFrom("listings")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .selectAll("listings")
    .select([
      "companies.name as company_name",
      "companies.slug as company_slug",
      "companies.logo_path as company_logo_path",
    ]);
  query =
    "active" in filter
      ? query
          .where("listings.delisted_at", "is", null)
          .where("listings.listed_at", "<=", filter.active)
          .orderBy("companies.name")
      : query
          .where("companies.slug", "=", filter.slug)
          .orderBy(sql`listings.delisted_at is null`, "desc")
          .orderBy("listings.listed_at", "desc")
          .limit(1);
  const rows = await query.execute();
  return rows.map(({ company_name, company_slug, company_logo_path, ...listing }) => ({
    ...listing,
    company: {
      id: listing.company_id,
      name: company_name,
      slug: company_slug,
      logo_path: company_logo_path,
    },
  }));
}

async function loadEpochs(db: Transaction<Database>, companyId: string): Promise<ListingEpoch[]> {
  const rows = await db
    .selectFrom("instruments")
    .innerJoin("listings", "listings.id", "instruments.listing_id")
    .innerJoin("markets", "markets.instrument_id", "instruments.id")
    .select([
      "instruments.id as instrument_id",
      "markets.id as market_id",
      "markets.status as market_status",
      "instruments.kind",
      "instruments.epoch",
      "instruments.state",
      "instruments.question",
      "instruments.opens_at",
      "instruments.expires_at",
      "instruments.closed_at",
    ])
    .where("listings.company_id", "=", companyId)
    .orderBy("instruments.opens_at", "desc")
    .orderBy("instruments.kind")
    .orderBy("instruments.epoch", "desc")
    .execute();
  return rows.map((row) => ({
    instrumentId: row.instrument_id,
    marketId: row.market_id,
    kind: row.kind,
    epoch: row.epoch,
    state: row.state,
    marketStatus: row.market_status,
    question: row.question,
    opensAt: row.opens_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    closedAt: row.closed_at?.toISOString() ?? null,
  }));
}

/** `GET /api/markets/[slug]`: the listed name's page data. */
export async function getMarket(
  db: Kysely<Database>,
  slug: string,
  options: GetMarketOptions = {},
): Promise<ListingDetail> {
  const at = readClock(options.now);
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (transaction) => {
      const [listing] = await loadListings(transaction, { slug });
      if (listing === undefined) {
        throw new ServiceError("MARKET_NOT_FOUND", "No listed name matches this address.");
      }
      const [view, epochs] = await Promise.all([
        readListings(transaction, [listing], at),
        loadEpochs(transaction, listing.company_id),
      ]);
      return { ...view[0]!, epochs, asOf: at.toISOString() };
    });
}
