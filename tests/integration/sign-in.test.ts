import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type IdentityProfile, upsertIdentity } from "../../src/lib/services/tournament/sign-in.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Sign-in PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Sign-in PostgreSQL integration";

function xProfile(id: string, handle: string): IdentityProfile {
  return {
    provider: "x",
    providerUserId: id,
    handle,
    displayName: handle,
    avatarUrl: null,
    verified: false,
    providerCreatedAt: new Date("2015-01-01T00:00:00Z"),
  };
}

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
  }, 30_000);

  it("reports created on an identity's first sign-in and existing on every later one", async () => {
    const first = await upsertIdentity(postgres.db, xProfile("501", "newcomer"));
    expect(first.created).toBe(true);

    const again = await upsertIdentity(postgres.db, xProfile("501", "renamed"));
    expect(again).toEqual({ userId: first.userId, created: false });

    const other = await upsertIdentity(postgres.db, xProfile("502", "someone"));
    expect(other.created).toBe(true);
    expect(other.userId).not.toBe(first.userId);
  });

  it("reports exactly one creation when first sign-ins race", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => upsertIdentity(postgres.db, xProfile("777", "racer"))),
    );
    expect(new Set(results.map((result) => result.userId)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    const users = await postgres.db.selectFrom("tournament_users").select("id").execute();
    expect(users).toEqual([{ id: results[0]!.userId }]);
  });
});
