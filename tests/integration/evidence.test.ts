import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getDealerAdmin } from "../../src/lib/services/dealer/get-dealer-admin.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { runSettleJob } from "../../src/lib/services/dealer/settle-instruments.js";
import { openQuestion, saveDraftQuestion } from "../../src/lib/services/tournament/admin.js";
import { evidenceDedupeKey } from "../../src/lib/services/tournament/evidence.js";
import { insertFixtureFlags, seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  createTrader,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  sessionCookie,
  TEST_DATABASE_SKIP_REASON,
  type TestTrader,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);
vi.mock("../../src/lib/logging/server-log.js", () => ({
  logReadRequest: vi.fn(),
  logUnexpectedError: vi.fn(),
}));

import { POST as reviewRoute } from "../../src/app/api/admin/dealer/evidence/[flagId]/review/route.js";
import { POST as evidenceRoute } from "../../src/app/api/t/questions/[slug]/evidence/route.js";

/**
 * POST /api/t/questions/[slug]/evidence and the admin review (milestone 7):
 * tournament sign-in, same-origin JSON, per-user and per-network quotas, a
 * low-confidence user_submitted flag for the linked instrument's name, and
 * an append-only confirm or reject.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Evidence PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Evidence PostgreSQL integration";

const ORIGIN = "https://evidence.openmarket.test";
const LISTED_AT = new Date("2026-09-01T00:00:00.000Z");
const SOURCE = "https://www.example.com/instinct-series-c";

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;
  let forecaster: TestTrader;
  let cookie: string;
  let questionSlug: string;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
    runtime.getRuntimeDatabase.mockImplementation(() => postgres.db);
  }, 30_000);

  beforeEach(async () => {
    vi.stubEnv("TOURNAMENT_LINKED_QUESTIONS", "1");
    await resetPostgresTestDatabase(postgres.db);
    await seedFixtureListings(postgres.db, LISTED_AT);
    await runDealerJob(postgres.db, "evidence-list", new Date("2026-09-01T00:05:00Z"));
    forecaster = await createTrader(postgres.db, "sleuth");
    cookie = await sessionCookie(postgres.db, forecaster.tournamentUserId);
    const linked = await postgres.db
      .selectFrom("tournament_instrument_links as links")
      .innerJoin("instruments", "instruments.id", "links.instrument_id")
      .innerJoin("listings", "listings.id", "instruments.listing_id")
      .innerJoin("companies", "companies.id", "listings.company_id")
      .innerJoin("tournament_questions as questions", "questions.id", "links.question_id")
      .select("questions.slug")
      .where("companies.slug", "=", "instinct")
      .where("instruments.kind", "=", "forward")
      .executeTakeFirstOrThrow();
    questionSlug = linked.slug;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("APP_ORIGIN", ORIGIN);
    vi.stubEnv("TOURNAMENT_ADMIN_X_IDS", "dev:admin");
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  function post(
    slug: string,
    body: unknown,
    options: { cookie?: string | null; origin?: string; network?: string } = {},
  ) {
    const sessionHeader = options.cookie === undefined ? cookie : options.cookie;
    return evidenceRoute(
      new Request(`${ORIGIN}/api/t/questions/${slug}/evidence`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: options.origin ?? ORIGIN,
          "x-vercel-forwarded-for": options.network ?? "192.0.2.10",
          ...(sessionHeader === null ? {} : { cookie: sessionHeader }),
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ slug }) },
    );
  }

  function review(flagId: string, body: unknown, reviewerCookie: string) {
    return reviewRoute(
      new Request(`${ORIGIN}/api/admin/dealer/evidence/${flagId}/review`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-vercel-forwarded-for": "192.0.2.10",
          cookie: reviewerCookie,
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ flagId }) },
    );
  }

  const evidence = {
    source_url: SOURCE,
    kind: "release",
    published_at: "2026-09-28T00:00:00.000Z",
    terms: { valuation_usd: 10_000_000_000, valuation_basis: "post", outlet: "BusinessWire" },
  };

  async function codeOf(response: Response) {
    return { status: response.status, code: (await response.json()).error?.code };
  }

  it("files a low-confidence user_submitted flag for the linked name, once per source", async () => {
    const response = await post(questionSlug, evidence);
    expect(response.status).toBe(200);
    const body = await response.json();
    const dedupeKey = evidenceDedupeKey({
      companySlug: "instinct",
      kind: "release",
      outlet: "BusinessWire",
      day: "2026-09-28",
      valuationUsd: 10_000_000_000,
    });
    expect(body).toMatchObject({
      question_slug: questionSlug,
      company: "Instinct",
      kind: "user_submitted",
      submitted_kind: "release",
      confidence: "low",
      dedupe_key: dedupeKey,
      review: "pending",
    });
    const row = await postgres.db
      .selectFrom("event_flags")
      .innerJoin("companies", "companies.id", "event_flags.company_id")
      .selectAll("event_flags")
      .select("companies.slug")
      .where("event_flags.id", "=", body.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      slug: "instinct",
      kind: "user_submitted",
      submitted_by: forecaster.tournamentUserId,
      submitted_kind: "release",
      source_url: SOURCE,
      source_rank: null,
      confidence: "low",
      run_id: null,
      promoted_from: null,
      terms_json: {
        valuation_usd: 10_000_000_000,
        valuation_basis: "post",
        outlet: "BusinessWire",
      },
    });

    const again = await post(questionSlug, evidence);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect((await again.json()).id).toBe(body.id);

    // The dealer reads none of it: the public evidence feed leaves it out.
    const flags = await postgres.db
      .selectFrom("event_flags")
      .select("id")
      .where("kind", "=", "user_submitted")
      .execute();
    expect(flags).toHaveLength(1);
  });

  it("requires a session, the same origin and JSON", async () => {
    expect(await codeOf(await post(questionSlug, evidence, { cookie: null }))).toEqual({
      status: 401,
      code: "USER_REQUIRED",
    });
    expect(
      await codeOf(await post(questionSlug, evidence, { origin: "https://elsewhere.test" })),
    ).toEqual({ status: 400, code: "INVALID_INPUT" });
    const plain = await evidenceRoute(
      new Request(`${ORIGIN}/api/t/questions/${questionSlug}/evidence`, {
        method: "POST",
        headers: { "content-type": "text/plain", origin: ORIGIN, cookie },
        body: JSON.stringify(evidence),
      }),
      { params: Promise.resolve({ slug: questionSlug }) },
    );
    expect(plain.status).toBe(400);
  });

  it("validates the body and refuses unlinked or unknown questions", async () => {
    const invalid = [
      { ...evidence, kind: "print" },
      { ...evidence, source_url: "ftp://example.com/x" },
      { ...evidence, terms: { valuation_basis: "post" } },
      { ...evidence, terms: { ...evidence.terms, lead: "Someone" } },
      { ...evidence, extra: true },
    ];
    for (const body of invalid) {
      expect(await codeOf(await post(questionSlug, body)), JSON.stringify(body)).toEqual({
        status: 400,
        code: "INVALID_INPUT",
      });
    }
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(await codeOf(await post(questionSlug, { ...evidence, published_at: future }))).toEqual({
      status: 400,
      code: "INVALID_INPUT",
    });

    await saveDraftQuestion(postgres.db, {
      slug: "unlinked-question",
      title: "Unlinked",
      description_md: "Description.",
      rulebook_md: "Rulebook.",
      rulebook_version: 1,
      unit: "bool",
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await openQuestion(postgres.db, "unlinked-question");
    expect(await codeOf(await post("unlinked-question", evidence))).toEqual({
      status: 409,
      code: "QUESTION_STATE",
    });
    expect(await codeOf(await post("no-such-question", evidence))).toEqual({
      status: 404,
      code: "QUESTION_NOT_FOUND",
    });
  });

  it("limits each forecaster to ten an hour and each network to thirty", async () => {
    const distinct = (index: number) => ({ ...evidence, source_url: `${SOURCE}/${index}` });
    for (let index = 0; index < 10; index += 1) {
      expect((await post(questionSlug, distinct(index))).status).toBe(200);
    }
    const limited = await post(questionSlug, distinct(10));
    expect(await codeOf(limited)).toEqual({ status: 429, code: "RATE_LIMITED" });

    // Three more forecasters on the same network reach its thirty.
    let filed = 10;
    for (const handle of ["second", "third", "fourth"]) {
      const other = await createTrader(postgres.db, handle);
      const otherCookie = await sessionCookie(postgres.db, other.tournamentUserId);
      for (let index = 0; index < 10; index += 1) {
        const response = await post(questionSlug, distinct(100 + filed), { cookie: otherCookie });
        if (filed < 30) {
          expect(response.status).toBe(200);
        } else {
          expect(await codeOf(response)).toEqual({ status: 429, code: "RATE_LIMITED" });
        }
        filed += 1;
      }
    }
    // Another network is unaffected.
    const fresh = await createTrader(postgres.db, "elsewhere");
    const freshCookie = await sessionCookie(postgres.db, fresh.tournamentUserId);
    const other = await post(questionSlug, distinct(999), {
      cookie: freshCookie,
      network: "192.0.2.99",
    });
    expect(other.status).toBe(200);
  });

  it("lets an admin confirm it by a later independent flag, once, or reject it", async () => {
    const filed = await (await post(questionSlug, evidence)).json();
    const second = await (
      await post(questionSlug, { ...evidence, source_url: `${SOURCE}/copy` })
    ).json();

    // The settle job promotes Instinct's Series C release to a print, after the submission.
    await insertFixtureFlags(
      postgres.db,
      "instinct",
      ["release"],
      (flag) => flag.published_at > "2026-09-01",
    );
    await runSettleJob(postgres.db, `evidence-settle-${randomUUID()}`, new Date());
    const print = await postgres.db
      .selectFrom("event_flags")
      .select("id")
      .where("kind", "=", "print")
      .executeTakeFirstOrThrow();

    const queue = (await getDealerAdmin(postgres.db, new Date())).evidence_queue;
    expect(queue.map((row) => row.flag_id)).toEqual([filed.id, second.id]);
    expect(queue[0]).toMatchObject({ company: "Instinct", submitter: "sleuth" });
    expect(queue[0]!.candidates.map((candidate) => candidate.flag_id)).toContain(print.id);

    const forecasterReview = await review(
      filed.id,
      { decision: "confirmed", confirming_flag_id: print.id },
      cookie,
    );
    expect(await codeOf(forecasterReview)).toEqual({ status: 401, code: "ADMIN_REQUIRED" });

    const admin = await createTrader(postgres.db, "admin");
    const adminCookie = await sessionCookie(postgres.db, admin.tournamentUserId);
    const earlier = await postgres.db
      .selectFrom("event_flags")
      .select("id")
      .where("kind", "=", "release")
      .executeTakeFirstOrThrow();
    // The release itself was observed on its fixture day, before the submission.
    expect(
      await codeOf(
        await review(
          filed.id,
          { decision: "confirmed", confirming_flag_id: earlier.id },
          adminCookie,
        ),
      ),
    ).toEqual({ status: 400, code: "INVALID_INPUT" });
    expect(await codeOf(await review(filed.id, { decision: "confirmed" }, adminCookie))).toEqual({
      status: 400,
      code: "INVALID_INPUT",
    });

    const confirmed = await review(
      filed.id,
      { decision: "confirmed", confirming_flag_id: print.id },
      adminCookie,
    );
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      flag_id: filed.id,
      decision: "confirmed",
      confirming_flag_id: print.id,
    });
    expect(await codeOf(await review(filed.id, { decision: "rejected" }, adminCookie))).toEqual({
      status: 409,
      code: "EVIDENCE_REVIEWED",
    });
    expect((await review(second.id, { decision: "rejected" }, adminCookie)).status).toBe(200);
    expect(await codeOf(await review(randomUUID(), { decision: "rejected" }, adminCookie))).toEqual(
      { status: 404, code: "EVIDENCE_NOT_FOUND" },
    );

    expect((await getDealerAdmin(postgres.db, new Date())).evidence_queue).toEqual([]);
    // Reviews are append-only.
    await expect(
      postgres.db.deleteFrom("event_flag_reviews").where("flag_id", "=", filed.id).execute(),
    ).rejects.toThrow(/append-only/);
  });
});
