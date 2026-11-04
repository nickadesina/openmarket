import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { generateApiKey, hashApiKey } from "../../src/lib/auth/api-key.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/rulebook.js";
import { insertApiKey } from "../../src/lib/services/ref-access.js";
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

import { GET as rulebookRoute } from "../../src/app/api/ref/rulebook/route.js";

/**
 * The public reference API: every payload opens with the envelope, every
 * anonymous success is cached 60 s, and the `ref` quota is 60 a minute per
 * network or a key's own. The rulebook is the one route until the index's
 * routes land (docs/prompts/v2, P5).
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Reference API PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Reference API PostgreSQL integration";

const ORIGIN = "https://openmkt.test";

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { headers });
}

function rulebook(headers: Record<string, string> = {}): Promise<Response> {
  return rulebookRoute(get("/api/ref/rulebook", headers));
}

async function expectPublished(response: Response, cache = "public, max-age=60, s-maxage=60") {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe(cache);
  const body = await response.json();
  expect(body).toMatchObject({ rulebook_version: RULEBOOK_VERSION });
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  it("publishes the rulebook under the envelope", async () => {
    const body = await expectPublished(await rulebook());
    expect(body.rulebook.version).toBe(RULEBOOK_VERSION);
    expect(Object.keys(body).slice(0, 2)).toEqual(["rulebook_version", "as_of"]);
  });

  describe("quota", () => {
    const network = { "x-vercel-forwarded-for": "203.0.113.7" };

    beforeEach(() => {
      vi.stubEnv("VERCEL", "1");
    });

    it("limits a network to 60 a minute and lets a live key past it", async () => {
      for (let index = 0; index < 60; index += 1) {
        expect((await rulebook(network)).status).toBe(200);
      }
      const limited = await rulebook(network);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(limited.headers.get("cache-control")).toBe("no-store");
      expect((await limited.json()).error.code).toBe("RATE_LIMITED");

      // Another network has its own bucket.
      expect((await rulebook({ "x-vercel-forwarded-for": "203.0.113.8" })).status).toBe(200);

      const key = generateApiKey();
      await insertApiKey(postgres.db, {
        name: "Desk",
        keyHash: hashApiKey(key),
        quotaPerMinute: 3,
      });
      const keyed = { ...network, authorization: `Bearer ${key}` };
      for (let index = 0; index < 3; index += 1) {
        await expectPublished(await rulebook(keyed), "private, no-store");
      }
      // The key's own quota, not the network's, now binds.
      expect((await rulebook(keyed)).status).toBe(429);

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
      expect((await rulebook({ ...network, authorization: `Bearer ${key}` })).status).toBe(200);
      await postgres.db
        .updateTable("api_keys")
        .set({ revoked_at: new Date() })
        .where("id", "=", created.id)
        .execute();
      for (const authorization of [`Bearer ${key}`, `Bearer ${generateApiKey()}`, "Bearer nope"]) {
        const response = await rulebook({ ...network, authorization });
        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect((await response.json()).error.code).toBe("API_KEY_INVALID");
      }
    });

    it("mints a design-partner key that expires in 365 days, counts its use, and is then refused by name", async () => {
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
      await expectPublished(await rulebook(keyed), "private, no-store");
      await expectPublished(await rulebook(keyed), "private, no-store");
      const usage = await postgres.db
        .selectFrom("api_key_usage")
        .select(["key_id", "request_count"])
        .execute();
      expect(usage).toEqual([{ key_id: created.id, request_count: 2 }]);

      // Past its expiry the key is refused, never served as public.
      const expiredAt = new Date(Date.now() - 1_000);
      await sql`update api_keys set created_at = ${new Date(expiredAt.getTime() - 86_400_000)}, expires_at = ${expiredAt} where id = ${created.id}`.execute(
        postgres.db,
      );
      const refused = await rulebook(keyed);
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
