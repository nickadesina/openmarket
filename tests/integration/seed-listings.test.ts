import { readFileSync } from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DEALER_PARAMS, MODEL_VERSION } from "../../src/lib/config/dealer.js";
import { EVENTS_CSV_PATH, listingAnchors } from "../../src/lib/config/listing-anchors.js";
import { seedListings } from "../../src/lib/services/dealer/seed-listings.js";
import { seedMarket } from "../../src/lib/services/seed-market.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * `npm run seed:listings` against PostgreSQL. Sources come from
 * tests/fixtures/listing-sources.csv, whose URLs are example.test
 * placeholders: backtest/data/sources.csv is the real file.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Seed listings PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Seed listings PostgreSQL integration";

const NAMES = Object.keys(DEALER_PARAMS.forward_t_days);
const EVENTS = readFileSync(EVENTS_CSV_PATH, "utf8");
const SOURCES = readFileSync("tests/fixtures/listing-sources.csv", "utf8");
const LISTED_AT = new Date("2026-10-22T00:00:00.000Z");
const LATER = new Date("2026-11-01T00:00:00.000Z");
const anchors = listingAnchors(EVENTS, SOURCES, NAMES);

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
  });

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  async function listingCount(): Promise<number> {
    const rows = await postgres.db.selectFrom("listings").select("id").execute();
    return rows.length;
  }

  it("lists the five names from the backtest's files and parameters", async () => {
    const results = await seedListings(postgres.db, {
      listedAt: LISTED_AT,
      relist: false,
      anchors,
    });
    expect(results.map((result) => [result.company.slug, result.outcome])).toEqual(
      NAMES.map((name) => [name.toLowerCase(), "created"]),
    );
    const bySlug = new Map(results.map((result) => [result.company.slug, result]));
    const openai = bySlug.get("openai")!;
    expect(openai.company.logo_path).toBe("/logos/openai.svg");
    expect(openai.listing).toMatchObject({
      tier: "mega",
      binary_event: "public_s1",
      kappa: DEALER_PARAMS.dealer.kappa,
      cap_cents: "2500000",
      b_cents: "200000",
      spread_floor: DEALER_PARAMS.dealer.s_floor,
      gamma: DEALER_PARAMS.dealer.gamma,
      p_floor: DEALER_PARAMS.dealer.p_floor,
      forward_t_days: DEALER_PARAMS.forward_t_days.OpenAI,
      model_version: MODEL_VERSION,
      anchor_round: "2026 mega-round (final close)",
      anchor_date: "2026-03-31",
      anchor_post_money_usd: "852000000000.00",
      // The better-ranked of the round's two fixture sources.
      anchor_source_url: "https://example.test/openai-release",
      anchor_source_rank: 1,
      listed_at: LISTED_AT,
      delisted_at: null,
    });
    expect(bySlug.get("modal")!.listing.binary_event).toBe("priced_round");
    expect(bySlug.get("instinct")!.listing).toMatchObject({
      // $10B is the mega threshold itself.
      tier: "mega",
      anchor_round: "Series C",
      anchor_source_rank: null,
    });
    const instruments = await postgres.db.selectFrom("instruments").select("id").execute();
    const markets = await postgres.db.selectFrom("markets").select("id").execute();
    expect([instruments.length, markets.length]).toEqual([0, 0]);
  });

  it("reuses an existing company row by slug", async () => {
    const existing = await seedMarket(postgres.db, {
      name: "Anthropic",
      slug: "anthropic",
      logo_path: "/logos/anthropic.svg",
      metric_kind: "yes_probability",
      b: 100,
      yes_probability: 0.5,
    });
    const results = await seedListings(postgres.db, {
      listedAt: LISTED_AT,
      relist: false,
      anchors,
    });
    const anthropic = results.find((result) => result.company.slug === "anthropic")!;
    expect(anthropic.company.id).toBe(existing.company.id);
    expect(anthropic.listing.company_id).toBe(existing.company.id);
  });

  it("is idempotent on (company, listed_at)", async () => {
    await seedListings(postgres.db, { listedAt: LISTED_AT, relist: false, anchors });
    const again = await seedListings(postgres.db, { listedAt: LISTED_AT, relist: true, anchors });
    expect(again.map((result) => result.outcome)).toEqual(NAMES.map(() => "unchanged"));
    expect(await listingCount()).toBe(5);
  });

  it("refuses a different active listing unless relisting, then delists the old one", async () => {
    const first = await seedListings(postgres.db, { listedAt: LISTED_AT, relist: false, anchors });
    await expect(
      seedListings(postgres.db, { listedAt: LATER, relist: false, anchors }),
    ).rejects.toThrow(/pass --relist/);
    expect(await listingCount()).toBe(5);
    await expect(
      seedListings(postgres.db, {
        listedAt: new Date(LISTED_AT.getTime() - 86_400_000),
        relist: true,
        anchors,
      }),
    ).rejects.toThrow(/later than the active listing/);

    const relisted = await seedListings(postgres.db, { listedAt: LATER, relist: true, anchors });
    expect(relisted.map((result) => result.outcome)).toEqual(NAMES.map(() => "relisted"));
    expect(relisted.map((result) => result.delisted?.id)).toEqual(
      first.map((result) => result.listing.id),
    );
    expect(
      relisted.every((result) => result.delisted?.delisted_at?.getTime() === LATER.getTime()),
    ).toBe(true);
    expect(await listingCount()).toBe(10);
    // The delisted row cannot be re-seeded at its own listed_at.
    await expect(
      seedListings(postgres.db, { listedAt: LISTED_AT, relist: true, anchors }),
    ).rejects.toThrow(/was delisted/);
  });

  it("refuses, writing nothing, when an anchor has no source URL", async () => {
    const withoutModal = SOURCES.split("\n")
      .filter((line) => !line.startsWith("Modal,"))
      .join("\n");
    await expect(
      seedListings(postgres.db, {
        listedAt: LISTED_AT,
        relist: false,
        anchors: listingAnchors(EVENTS, withoutModal, NAMES),
      }),
    ).rejects.toThrow("Refusing to list: no source_url for the anchor of Modal");
    await expect(
      seedListings(postgres.db, {
        listedAt: LISTED_AT,
        relist: false,
        anchors: listingAnchors(EVENTS, null, NAMES),
      }),
    ).rejects.toThrow(/no source_url/);
    expect(await listingCount()).toBe(0);
    const companies = await postgres.db.selectFrom("companies").select("id").execute();
    expect(companies).toHaveLength(0);
  });

  it("refuses a listing that predates its anchor round", async () => {
    await expect(
      seedListings(postgres.db, {
        listedAt: new Date("2026-10-01T00:00:00.000Z"),
        relist: false,
        anchors,
      }),
    ).rejects.toThrow(/Modal: listed_at precedes the anchor round/);
    expect(await listingCount()).toBe(0);
  });
});
