import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { generateApiKey, hashApiKey } from "../../src/lib/auth/api-key.js";
import { MODEL_VERSION } from "../../src/lib/config/dealer.js";
import { BLEND_SCHEDULE, BLEND_VERSION } from "../../src/lib/engine/dealer/blend.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/dealer/rulebook.js";
import { getDealerAdmin } from "../../src/lib/services/dealer/get-dealer-admin.js";
import { insertApiKey } from "../../src/lib/services/dealer/ref-access.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { insertFixtureFlags, NAMES, seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);
vi.mock("../../src/lib/logging/server-log.js", () => ({
  logReadRequest: vi.fn(),
  logMutationRequest: vi.fn(),
  logUnexpectedError: vi.fn(),
}));

import { GET as flagsRoute } from "../../src/app/api/ref/[slug]/flags/route.js";
import { GET as historyRoute } from "../../src/app/api/ref/[slug]/history/route.js";
import { GET as midsRoute } from "../../src/app/api/ref/[slug]/mids/route.js";
import { GET as referenceRoute } from "../../src/app/api/ref/[slug]/route.js";
import { GET as listingsRoute } from "../../src/app/api/ref/listings/route.js";
import { GET as rulebookRoute } from "../../src/app/api/ref/rulebook/route.js";

/**
 * The public reference API (README D14): every payload carries the four
 * versions, every success is cached 60 s, and the `ref` quota is 60 a
 * minute per network or a key's own.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Reference API PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Reference API PostgreSQL integration";

const LISTED_AT = new Date("2026-10-20T00:00:00.000Z");
const RUN_AT = new Date("2026-10-20T00:05:00.000Z");
const ORIGIN = "https://openmkt.test";
const ENVELOPE = {
  model_version: MODEL_VERSION,
  rulebook_version: RULEBOOK_VERSION,
  blend_version: BLEND_VERSION,
};

type SlugRoute = (
  request: Request,
  context: { params: Promise<{ slug: string }> },
) => Promise<Response>;

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { headers });
}

function slugCall(route: SlugRoute, slug: string, query = "", headers = {}) {
  const suffix =
    route === referenceRoute
      ? ""
      : `/${route === historyRoute ? "history" : route === midsRoute ? "mids" : "flags"}`;
  return route(get(`/api/ref/${slug}${suffix}${query}`, headers), {
    params: Promise.resolve({ slug }),
  });
}

async function expectPublished(response: Response, cache = "public, max-age=60, s-maxage=60") {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe(cache);
  const body = await response.json();
  expect(body).toMatchObject(ENVELOPE);
  expect(Number.isNaN(Date.parse(body.as_of))).toBe(false);
  return body;
}

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
    runtime.getRuntimeDatabase.mockImplementation(() => postgres.db);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    await seedFixtureListings(postgres.db, LISTED_AT);
    await runDealerJob(postgres.db, "ref-api-1", RUN_AT);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  it("lists every name with tier, live instruments, parameters and T", async () => {
    const body = await expectPublished(await listingsRoute(get("/api/ref/listings")));
    expect(body.blend).toEqual(BLEND_SCHEDULE);
    expect(body.listings).toHaveLength(NAMES.length);
    const modal = body.listings.find((listing: { slug: string }) => listing.slug === "modal");
    expect(modal).toMatchObject({
      name: "Modal",
      tier: expect.stringMatching(/^(mega|redhot)$/),
      forward_t_days: expect.any(Number),
      parameters: {
        kappa: expect.any(Number),
        cap_usd: expect.any(Number),
        b_usd: expect.any(Number),
        p_floor: expect.any(Number),
        sigma_tier: expect.any(Number),
      },
      anchor: { post_money_usd: expect.any(Number), source_url: expect.any(String) },
    });
    expect(modal.instruments.map((instrument: { kind: string }) => instrument.kind).sort()).toEqual(
      ["binary", "forward"],
    );
  });

  it("publishes the reference forward and hazard, components, print, expiry and inventory sign", async () => {
    const body = await expectPublished(await slugCall(referenceRoute, "modal"));
    const mids = await postgres.db
      .selectFrom("model_mids")
      .innerJoin("instruments", "instruments.id", "model_mids.instrument_id")
      .innerJoin("listings", "listings.id", "instruments.listing_id")
      .innerJoin("companies", "companies.id", "listings.company_id")
      .select(["instruments.kind", "model_mids.mid_ln", "model_mids.p", "model_mids.id"])
      .where("companies.slug", "=", "modal")
      .execute();
    const forwardMid = mids.find((mid) => mid.kind === "forward")!;
    const binaryMid = mids.find((mid) => mid.kind === "binary")!;
    expect(body.reference_forward).toMatchObject({
      ...ENVELOPE,
      ln: forwardMid.mid_ln,
      usd: Math.round(Math.exp(forwardMid.mid_ln!) * 100) / 100,
      model_only: true,
      weights: { model: 1, traded: 0, crowd: 0 },
      components: { model: { model_mid_id: forwardMid.id } },
    });
    expect(body.reference_hazard).toMatchObject({
      p: binaryMid.p,
      model_only: true,
      components: { model: { model_mid_id: binaryMid.id } },
    });
    expect(body.dealer_inventory_sign).toBe(0);
    expect(body.next_expiry).toMatchObject({ kind: expect.any(String) });
    expect(body.last_print).toMatchObject({ post_money_usd: expect.any(Number), flag_id: null });
    expect(body.instruments).toHaveLength(2);
  });

  it("pages the history's references and quote tape on their own keysets", async () => {
    const all = await expectPublished(await slugCall(historyRoute, "modal"));
    expect(all.references).toHaveLength(2);
    expect(all.quotes.length).toBeGreaterThanOrEqual(2);
    expect(all.next_cursor).toBeNull();
    expect(all.quotes[0]).not.toHaveProperty("inventory_cents");
    expect(all.quotes[0]).toHaveProperty("dealer_inventory_sign", 0);

    const seen = { references: [] as string[], quotes: [] as string[] };
    let cursor: string | null = "";
    let pages = 0;
    while (cursor !== null) {
      const query = `?limit=1${cursor === "" ? "" : `&cursor=${cursor}`}`;
      const page = await expectPublished(await slugCall(historyRoute, "modal", query));
      seen.references.push(...page.references.map((row: { id: string }) => row.id));
      seen.quotes.push(...page.quotes.map((row: { sequence: string }) => row.sequence));
      cursor = page.next_cursor;
      pages += 1;
      expect(pages).toBeLessThan(20);
    }
    expect(seen.references).toEqual(all.references.map((row: { id: string }) => row.id));
    expect(seen.quotes).toEqual(all.quotes.map((row: { sequence: string }) => row.sequence));

    const before = await expectPublished(
      await slugCall(historyRoute, "modal", "?to=2026-10-20T00:00:00Z"),
    );
    expect(before.references).toEqual([]);
    expect((await slugCall(historyRoute, "modal", "?cursor=bm9wZQ")).status).toBe(400);
    expect((await slugCall(historyRoute, "modal", "?from=yesterday")).status).toBe(400);
    expect(
      (await slugCall(historyRoute, "modal", "?from=2026-10-21T00:00:00Z&to=2026-10-20T00:00:00Z"))
        .status,
    ).toBe(400);
  });

  it("publishes the forecast log unredacted and the evidence with the mids that cite it", async () => {
    const mids = await expectPublished(await slugCall(midsRoute, "modal"));
    expect(mids.mids).toHaveLength(2);
    expect(mids.mids[0]).toMatchObject({ inputs: { kind: expect.any(String), anchor: {} } });

    // Listed on 1 October, after Modal's 23 September scoop and before its 14 October round:
    // the forward re-centres on the scoop, and the flag names the mid that read it.
    await resetPostgresTestDatabase(postgres.db);
    await seedFixtureListings(postgres.db, new Date("2026-10-01T00:00:00.000Z"));
    const [scoop] = await insertFixtureFlags(
      postgres.db,
      "modal",
      ["scoop"],
      (flag) => flag.published_at === "2026-09-23",
    );
    expect(scoop).toBeDefined();
    await runDealerJob(postgres.db, "ref-api-cited", new Date("2026-10-01T00:05:00.000Z"));

    const body = await expectPublished(await slugCall(flagsRoute, "modal"));
    expect(body.flags).toHaveLength(1);
    const [flag] = body.flags;
    expect(flag).toMatchObject({
      kind: "scoop",
      dedupe_key: scoop!.dedupe_key,
      terms: { valuation_usd: 15_000_000_000 },
    });
    const forwardMid = await postgres.db
      .selectFrom("model_mids")
      .innerJoin("instruments", "instruments.id", "model_mids.instrument_id")
      .innerJoin("listings", "listings.id", "instruments.listing_id")
      .innerJoin("companies", "companies.id", "listings.company_id")
      .select(["model_mids.id", "model_mids.inputs_json"])
      .where("companies.slug", "=", "modal")
      .where("instruments.kind", "=", "forward")
      .executeTakeFirstOrThrow();
    expect(forwardMid.inputs_json).toMatchObject({ leak: { flag_id: flag.id } });
    expect(flag.cited_by_mids).toContain(forwardMid.id);
  });

  it("refuses an unknown name without caching the error", async () => {
    const response = await slugCall(referenceRoute, "stripe");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await slugCall(midsRoute, "Not A Slug")).status).toBe(400);
  });

  it("adds blend_version to the rulebook", async () => {
    const body = await expectPublished(await rulebookRoute(get("/api/ref/rulebook")));
    expect(body.rulebook.version).toBe(RULEBOOK_VERSION);
  });

  describe("quota", () => {
    const network = { "x-vercel-forwarded-for": "203.0.113.7" };

    beforeEach(() => {
      vi.stubEnv("VERCEL", "1");
    });

    it("limits a network to 60 a minute and lets a live key past it", async () => {
      for (let index = 0; index < 60; index += 1) {
        expect((await rulebookRoute(get("/api/ref/rulebook", network))).status).toBe(200);
      }
      const limited = await listingsRoute(get("/api/ref/listings", network));
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(limited.headers.get("cache-control")).toBe("no-store");
      expect((await limited.json()).error.code).toBe("RATE_LIMITED");

      // Another network has its own bucket.
      const elsewhere = { "x-vercel-forwarded-for": "203.0.113.8" };
      expect((await rulebookRoute(get("/api/ref/rulebook", elsewhere))).status).toBe(200);

      const key = generateApiKey();
      await insertApiKey(postgres.db, {
        name: "Desk",
        keyHash: hashApiKey(key),
        quotaPerMinute: 3,
      });
      const keyed = { ...network, authorization: `Bearer ${key}` };
      for (let index = 0; index < 3; index += 1) {
        await expectPublished(
          await listingsRoute(get("/api/ref/listings", keyed)),
          "private, no-store",
        );
      }
      // The key's own quota, not the network's, now binds.
      expect((await listingsRoute(get("/api/ref/listings", keyed))).status).toBe(429);

      const stored = await postgres.db.selectFrom("api_keys").selectAll().execute();
      expect(stored).toHaveLength(1);
      expect(stored[0]!.key_hash).toBe(hashApiKey(key));
      expect(JSON.stringify(stored)).not.toContain(key);
    });

    it("refuses a revoked, unknown or malformed key", async () => {
      const key = generateApiKey();
      const created = await insertApiKey(postgres.db, {
        name: "Revoked desk",
        keyHash: hashApiKey(key),
        quotaPerMinute: 100,
      });
      const keyed = { ...network, authorization: `Bearer ${key}` };
      expect((await listingsRoute(get("/api/ref/listings", keyed))).status).toBe(200);
      await postgres.db
        .updateTable("api_keys")
        .set({ revoked_at: new Date() })
        .where("id", "=", created.id)
        .execute();
      for (const authorization of [`Bearer ${key}`, `Bearer ${generateApiKey()}`, "Bearer nope"]) {
        const response = await listingsRoute(
          get("/api/ref/listings", { ...network, authorization }),
        );
        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect((await response.json()).error.code).toBe("API_KEY_INVALID");
      }
    });

    it("mints a design-partner key that expires in 365 days and is then refused by name", async () => {
      const key = generateApiKey();
      const created = await insertApiKey(postgres.db, {
        name: "Trial desk",
        keyHash: hashApiKey(key),
        quotaPerMinute: 600,
        tier: "design_partner",
      });
      expect(created.tier).toBe("design_partner");
      expect(created.expires_at!.getTime() - created.created_at.getTime()).toBe(365 * 86_400_000);

      const keyed = { ...network, authorization: `Bearer ${key}` };
      await expectPublished(
        await listingsRoute(get("/api/ref/listings", keyed)),
        "private, no-store",
      );
      await expectPublished(
        await rulebookRoute(get("/api/ref/rulebook", keyed)),
        "private, no-store",
      );

      const admin = await getDealerAdmin(postgres.db, new Date());
      expect(admin.api_keys).toEqual([
        expect.objectContaining({
          id: created.id,
          name: "Trial desk",
          tier: "design_partner",
          expires_at: created.expires_at,
          requests_7d: 2,
        }),
      ]);
      expect(JSON.stringify(admin.api_keys)).not.toContain(hashApiKey(key));

      // Past its expiry the key is refused, never served as public.
      const expiredAt = new Date(Date.now() - 1_000);
      await sql`update api_keys set created_at = ${new Date(expiredAt.getTime() - 86_400_000)}, expires_at = ${expiredAt} where id = ${created.id}`.execute(
        postgres.db,
      );
      const refused = await listingsRoute(get("/api/ref/listings", keyed));
      expect(refused.status).toBe(401);
      expect(refused.headers.get("cache-control")).toBe("no-store");
      const body = await refused.json();
      expect(body.error.code).toBe("API_KEY_EXPIRED");
      expect(body.error.message).toBe(`The API key expired on ${expiredAt.toISOString()}.`);
      expect(body.error.details).toEqual({ expired_at: expiredAt.toISOString() });
    });

    it("keeps keys minted before tiers as standard keys that never expire", async () => {
      const created = await insertApiKey(postgres.db, {
        name: "Standard desk",
        keyHash: hashApiKey(generateApiKey()),
        quotaPerMinute: 100,
      });
      expect(created).toMatchObject({ tier: "standard", expires_at: null });
      await expect(
        sql`insert into api_keys (name, key_hash, quota_per_minute, tier) values ('No expiry', ${hashApiKey(generateApiKey())}, 600, 'design_partner')`.execute(
          postgres.db,
        ),
      ).rejects.toThrow(/api_keys_design_partner_expires/);
    });
  });
});
