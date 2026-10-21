import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/auth/tournament-password.js";
import { TOURNAMENT_SESSION_COOKIE } from "../../src/lib/auth/tournament-session.js";
import { openQuestion, saveDraftQuestion } from "../../src/lib/services/tournament/admin.js";
import { setAffiliationForHandle } from "../../src/lib/services/tournament/affiliation.js";
import { getForecaster } from "../../src/lib/services/tournament/forecaster.js";
import { listLatestForecasts } from "../../src/lib/services/tournament/get-question.js";
import { userIdForHandle } from "../../src/lib/services/tournament/identities.js";
import { upsertIdentity } from "../../src/lib/services/tournament/sign-in.js";
import { submitForecast } from "../../src/lib/services/tournament/submit-forecast.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);

import { POST as loginRoute } from "../../src/app/api/t/auth/password/login/route.js";
import { POST as registerRoute } from "../../src/app/api/t/auth/password/register/route.js";
import { POST as affiliationRoute } from "../../src/app/api/t/me/affiliation/route.js";

const APP_ORIGIN = "https://accounts.openmarket.test";
const HOUR = 60 * 60 * 1000;
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Tournament accounts PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Tournament accounts PostgreSQL integration";

function post(path: string, body: unknown, cookie?: string): Request {
  return new Request(`${APP_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: APP_ORIGIN,
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

function sessionFrom(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const token = header.match(new RegExp(`${TOURNAMENT_SESSION_COOKIE}=([^;]+)`))?.[1];
  if (token === undefined) throw new Error("no session cookie");
  return `${TOURNAMENT_SESSION_COOKIE}=${token}`;
}

describe("tournament password hashing", () => {
  it("round-trips and rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse battery!", hash)).toBe(false);
  });
});

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    runtime.getRuntimeDatabase.mockReturnValue(postgres.db);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  it("registers once per username, signs in, and throttles failed guesses", async () => {
    const created = await registerRoute(
      post("/api/t/auth/password/register", { username: "Kim_F", password: "long enough pw" }),
    );
    expect(created.status).toBe(200);
    expect(sessionFrom(created)).toContain(TOURNAMENT_SESSION_COOKIE);

    const duplicate = await registerRoute(
      post("/api/t/auth/password/register", { username: "kim_f", password: "another long pw" }),
    );
    expect(duplicate.status).toBe(409);
    const short = await registerRoute(
      post("/api/t/auth/password/register", { username: "lee", password: "short" }),
    );
    expect(short.status).toBe(400);

    const good = await loginRoute(
      post("/api/t/auth/password/login", { username: "KIM_F", password: "long enough pw" }),
    );
    expect(good.status).toBe(200);

    const unknown = await loginRoute(
      post("/api/t/auth/password/login", { username: "nobody", password: "whatever pw" }),
    );
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toMatchObject({ error: { code: "SIGN_IN_FAILED" } });

    for (let attempt = 0; attempt < 9; attempt += 1) {
      const wrong = await loginRoute(
        post("/api/t/auth/password/login", { username: "kim_f", password: `wrong ${attempt}` }),
      );
      expect(wrong.status).toBe(401);
    }
    // Ten failures from this network (the unknown username counts too): the next is refused
    // before the password is checked, even with the right password.
    const locked = await loginRoute(
      post("/api/t/auth/password/login", { username: "kim_f", password: "long enough pw" }),
    );
    expect(locked.status).toBe(429);
  });

  it("keeps usernames apart from X handles and lets them forecast", async () => {
    const xUser = await upsertIdentity(postgres.db, {
      provider: "x",
      providerUserId: "77",
      handle: "kim",
      displayName: "Kim on X",
      avatarUrl: null,
      verified: false,
      providerCreatedAt: new Date("2015-01-01T00:00:00Z"),
    });
    const created = await registerRoute(
      post("/api/t/auth/password/register", { username: "kim", password: "long enough pw" }),
    );
    expect(created.status).toBe(200);

    const passwordUser = await userIdForHandle(postgres.db, "~kim");
    expect(await userIdForHandle(postgres.db, "kim")).toBe(xUser);
    expect(passwordUser).toBeDefined();
    expect(passwordUser).not.toBe(xUser);

    const profile = await getForecaster(postgres.db, "~kim");
    expect(profile.identity).toMatchObject({ provider: "password", profileSlug: "~kim" });

    // Username accounts have no external account age, so the 90-day rule does not apply.
    const now = Date.now();
    await saveDraftQuestion(postgres.db, {
      slug: "accounts-q",
      title: "Accounts",
      description_md: "D.",
      rulebook_md: "R.",
      rulebook_version: 1,
      unit: "bool",
      opens_at: new Date(now - HOUR).toISOString(),
      closes_at: new Date(now + HOUR).toISOString(),
    });
    await openQuestion(postgres.db, "accounts-q");
    await submitForecast(postgres.db, {
      slug: "accounts-q",
      userId: passwordUser!,
      probs: [0.4, 0.6],
    });
    const { forecasts } = await listLatestForecasts(postgres.db, "accounts-q");
    expect(forecasts.map((forecast) => forecast.profileSlug)).toEqual(["~kim"]);
  });

  it("sets, clears, and validates a self-reported affiliation", async () => {
    const created = await registerRoute(
      post("/api/t/auth/password/register", { username: "ana", password: "long enough pw" }),
    );
    const cookie = sessionFrom(created);

    const set = await affiliationRoute(
      post("/api/t/me/affiliation", { affiliation: "  UC Berkeley  " }, cookie),
    );
    expect(await set.json()).toEqual({ affiliation: "UC Berkeley" });
    expect((await getForecaster(postgres.db, "~ana")).identity.affiliation).toBe("UC Berkeley");

    const control = await affiliationRoute(
      post("/api/t/me/affiliation", { affiliation: "Lab\u0000" }, cookie),
    );
    expect(control.status).toBe(400);
    const tooLong = await affiliationRoute(
      post("/api/t/me/affiliation", { affiliation: "x".repeat(61) }, cookie),
    );
    expect(tooLong.status).toBe(400);
    const anonymous = await affiliationRoute(post("/api/t/me/affiliation", { affiliation: "MIT" }));
    expect(anonymous.status).toBe(401);

    await affiliationRoute(post("/api/t/me/affiliation", { affiliation: "" }, cookie));
    expect((await getForecaster(postgres.db, "~ana")).identity.affiliation).toBeNull();

    await setAffiliationForHandle(postgres.db, "~ana", "Independent");
    expect((await getForecaster(postgres.db, "~ana")).identity.affiliation).toBe("Independent");
  });
});
