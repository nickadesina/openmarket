import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuestionInput } from "../../src/lib/api/tournament-schemas.js";
import {
  createTournamentSession,
  TOURNAMENT_SESSION_COOKIE,
} from "../../src/lib/auth/tournament-session.js";
import { aggregateForecasts } from "../../src/lib/engine/tournament/aggregate.js";
import { timeAveragedScore } from "../../src/lib/engine/tournament/score.js";
import {
  closeQuestion,
  openQuestion,
  resolveQuestion,
  saveDraftQuestion,
  setUserFlag,
  voidQuestion,
} from "../../src/lib/services/tournament/admin.js";
import { getForecaster } from "../../src/lib/services/tournament/forecaster.js";
import { getQuestion, listQuestions } from "../../src/lib/services/tournament/get-question.js";
import { getLeaderboard } from "../../src/lib/services/tournament/leaderboard.js";
import { upsertIdentity } from "../../src/lib/services/tournament/sign-in.js";
import { submitForecast } from "../../src/lib/services/tournament/submit-forecast.js";
import { verifyTournament } from "../../src/lib/services/tournament/verify-tournament.js";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);

import { GET as meRoute } from "../../src/app/api/t/me/route.js";
import { POST as forecastRoute } from "../../src/app/api/t/questions/[slug]/forecasts/route.js";

const APP_ORIGIN = "https://tournament.openmarket.test";
const HOUR = 60 * 60 * 1000;
const OLD_ACCOUNT = new Date("2015-01-01T00:00:00Z");
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Tournament PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Tournament PostgreSQL integration";

function binary(slug: string, opensAt: Date, closesAt: Date): QuestionInput {
  return {
    slug,
    title: `Binary ${slug}`,
    description_md: "Description.",
    rulebook_md: "Rulebook.",
    rulebook_version: 1,
    unit: "bool",
    opens_at: opensAt.toISOString(),
    closes_at: closesAt.toISOString(),
  };
}

function ladder(
  slug: string,
  opensAt: Date,
  closesAt: Date,
  edges: number[],
  expiresAt: Date = closesAt,
): QuestionInput {
  return {
    slug,
    title: `Ladder ${slug}`,
    description_md: "Description.",
    rulebook_md: "Rulebook.",
    rulebook_version: 1,
    unit: slug.includes("mcap") ? "USD_T" : "USD_B",
    opens_at: opensAt.toISOString(),
    closes_at: closesAt.toISOString(),
    expiry_at: expiresAt.toISOString(),
    buckets: { edges, floor_label: "Nothing by expiry" },
  };
}

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;
  let users: string[];

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    users = [];
    for (let index = 0; index < 6; index += 1) {
      users.push(
        await upsertIdentity(postgres.db, {
          provider: "x",
          providerUserId: String(1_000 + index),
          handle: `Forecaster${index}`,
          displayName: `Forecaster ${index}`,
          avatarUrl: null,
          verified: index === 0,
          providerCreatedAt: OLD_ACCOUNT,
        }),
      );
    }
    runtime.getRuntimeDatabase.mockReturnValue(postgres.db);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  async function openBinary(slug = "binary-q"): Promise<void> {
    const now = Date.now();
    await saveDraftQuestion(postgres.db, binary(slug, new Date(now - HOUR), new Date(now + HOUR)));
    await openQuestion(postgres.db, slug);
  }

  it("keeps an identity per X id and refreshes its handle", async () => {
    const again = await upsertIdentity(postgres.db, {
      provider: "x",
      providerUserId: "1000",
      handle: "Renamed",
      displayName: "Renamed",
      avatarUrl: "https://pbs.twimg.com/a.jpg",
      verified: true,
      providerCreatedAt: OLD_ACCOUNT,
    });
    expect(again).toBe(users[0]);
    const profile = await getForecaster(postgres.db, "renamed");
    expect(profile.identity.handle).toBe("Renamed");
  });

  it("hides drafts and pins a question once open", async () => {
    const now = Date.now();
    const input = binary("pinned", new Date(now - HOUR), new Date(now + HOUR));
    await saveDraftQuestion(postgres.db, input);
    expect(await listQuestions(postgres.db)).toHaveLength(0);
    await saveDraftQuestion(postgres.db, { ...input, title: "Edited draft" });
    await openQuestion(postgres.db, "pinned");
    expect((await listQuestions(postgres.db))[0]!.title).toBe("Edited draft");
    await expect(saveDraftQuestion(postgres.db, input)).rejects.toMatchObject({
      code: "QUESTION_STATE",
    });
  });

  it("validates, rate-limits, and publishes the aggregate only from five forecasters", async () => {
    await openBinary();
    await expect(
      submitForecast(postgres.db, { slug: "binary-q", userId: users[0]!, probs: [0.5] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      submitForecast(postgres.db, { slug: "binary-q", userId: users[0]!, probs: [0.5, 0.6] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const vectors = [
      [0.7, 0.3],
      [0.6, 0.4],
      [0.8, 0.2],
      [0.55, 0.45],
      [0.9, 0.1],
    ];
    for (let index = 0; index < 4; index += 1) {
      await submitForecast(postgres.db, {
        slug: "binary-q",
        userId: users[index]!,
        probs: vectors[index]!,
      });
    }
    let question = await getQuestion(postgres.db, "binary-q");
    expect(question.aggregate).toMatchObject({ nForecasters: 4, published: false, probs: null });

    const stored = await submitForecast(postgres.db, {
      slug: "binary-q",
      userId: users[4]!,
      probs: vectors[4]!,
    });
    expect(stored.eventHash).toMatch(/^[0-9a-f]{64}$/);
    question = await getQuestion(postgres.db, "binary-q");
    expect(question.aggregate!.published).toBe(true);
    const expected = aggregateForecasts(vectors, 1.5)!;
    expect(question.aggregate!.probs![0]).toBeCloseTo(expected[0]!, 9);
    expect(question.aggregate!.pYes).toBeCloseTo(expected[0]!, 9);

    await expect(
      submitForecast(postgres.db, { slug: "binary-q", userId: users[0]!, probs: [0.1, 0.9] }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("rejects accounts younger than the question's minimum age", async () => {
    await openBinary();
    const young = await upsertIdentity(postgres.db, {
      provider: "x",
      providerUserId: "9999",
      handle: "Fresh",
      displayName: "Fresh",
      avatarUrl: null,
      verified: false,
      providerCreatedAt: new Date(),
    });
    await expect(
      submitForecast(postgres.db, { slug: "binary-q", userId: young, probs: [0.5, 0.5] }),
    ).rejects.toMatchObject({ code: "ACCOUNT_TOO_NEW" });
  });

  it("closes, resolves, scores, supersedes in the dispute window, and ranks", async () => {
    await openBinary();
    const question = await getQuestion(postgres.db, "binary-q");
    const questionRow = await postgres.db
      .selectFrom("tournament_questions")
      .select(["id", "opens_at"])
      .executeTakeFirstOrThrow();
    // Back-dated events give the scorer a known timeline.
    const opensAt = questionRow.opens_at.getTime();
    const timeline = [
      { user: 0, at: opensAt, probs: [0.9, 0.1] },
      { user: 1, at: opensAt + HOUR / 2, probs: [0.2, 0.8] },
      { user: 0, at: opensAt + HOUR / 2, probs: [0.6, 0.4] },
    ];
    for (const event of timeline) {
      await postgres.db
        .insertInto("tournament_forecast_events")
        .values({
          user_id: users[event.user]!,
          question_id: questionRow.id,
          submitted_at: new Date(event.at),
          probs: event.probs.map(String),
          event_hash: "0".repeat(64),
        })
        .execute();
    }

    await expect(
      resolveQuestion(
        postgres.db,
        "binary-q",
        {
          resolved_value: null,
          winning_bucket_index: 0,
          rung_fired: null,
          source_url: null,
          source_excerpt: null,
          note_md: "Early.",
        },
        users[0]!,
      ),
    ).rejects.toMatchObject({ code: "QUESTION_STATE" });

    const { closedAt } = await closeQuestion(postgres.db, "binary-q", {});
    await expect(
      submitForecast(postgres.db, { slug: "binary-q", userId: users[2]!, probs: [0.5, 0.5] }),
    ).rejects.toMatchObject({ code: "QUESTION_NOT_OPEN" });

    const resolution = {
      resolved_value: null,
      winning_bucket_index: 0,
      rung_fired: null,
      source_url: "https://www.sec.gov/edgar",
      source_excerpt: "Form S-1",
      note_md: "Filed.",
    };
    const outcome = await resolveQuestion(postgres.db, "binary-q", resolution, users[0]!);
    expect(outcome.scoresWritten).toBe(2);

    const end = new Date(closedAt).getTime();
    const expectedFirst = timeAveragedScore({
      bucketCount: 2,
      winningIndex: 0,
      opensAt,
      closesAt: end,
      forecasts: timeline
        .filter((event) => event.user === 0)
        .map((event) => ({ at: event.at, probs: event.probs })),
    })!;
    let board = await getLeaderboard(postgres.db, "all");
    expect(board.entries.map((entry) => entry.handle)).toEqual(["Forecaster0", "Forecaster1"]);
    expect(board.entries[0]!.totalScore).toBeCloseTo(expectedFirst.timeAvgLogScore, 9);
    expect(board.entries[0]!.rank).toBe(1);

    const detail = await getQuestion(postgres.db, "binary-q");
    expect(detail.status).toBe("resolved");
    expect(detail.resolutionDetail!.topForecasters).toHaveLength(2);
    expect(detail.resolutionDetail!.finalAggregate!.nForecasters).toBe(2);
    expect(question.rules.minPublishedForecasters).toBe(5);

    // A dispute inside the window replaces the live row and rescoring follows it.
    const corrected = await resolveQuestion(
      postgres.db,
      "binary-q",
      { ...resolution, winning_bucket_index: 1, note_md: "Corrected: a DRS, not an S-1." },
      users[0]!,
    );
    expect(corrected.supersededResolutionId).toBe(outcome.resolutionId);
    board = await getLeaderboard(postgres.db, "all");
    expect(board.entries[0]!.handle).toBe("Forecaster1");
    expect((await getQuestion(postgres.db, "binary-q")).resolutionDetail!.supersededCount).toBe(1);

    expect(await verifyTournament(postgres.db)).toMatchObject({ passed: true, findings: [] });

    const positions = await getForecaster(postgres.db, "forecaster1");
    expect(positions.resolved).toHaveLength(1);
    expect(positions.resolved[0]!.winningBucketLabel).toBe("No");

    // The record is append-only.
    await expect(
      sql`update tournament_forecast_events set client_hash = 'x'`.execute(postgres.db),
    ).rejects.toThrow(/append-only/);
    await expect(sql`delete from tournament_scores`.execute(postgres.db)).rejects.toThrow(
      /append-only/,
    );
    await expect(
      sql`update tournament_resolutions set note_md = 'changed'`.execute(postgres.db),
    ).rejects.toThrow(/superseded/);
  });

  it("voids without scoring and refuses to resolve a voided question", async () => {
    await openBinary();
    await submitForecast(postgres.db, { slug: "binary-q", userId: users[0]!, probs: [0.5, 0.5] });
    await voidQuestion(postgres.db, "binary-q", { note_md: "Ambiguous rulebook." });
    await expect(
      resolveQuestion(
        postgres.db,
        "binary-q",
        {
          resolved_value: null,
          winning_bucket_index: 0,
          rung_fired: null,
          source_url: null,
          source_excerpt: null,
          note_md: "x",
        },
        users[0]!,
      ),
    ).rejects.toMatchObject({ code: "QUESTION_STATE" });
    expect((await getLeaderboard(postgres.db, "all")).entries).toHaveLength(0);
  });

  it("maps a resolved value to its bucket and holds the floor until expiry or an early close", async () => {
    const now = Date.now();
    // Past its scheduled close, not closed early, expiry still ahead.
    await saveDraftQuestion(
      postgres.db,
      ladder(
        "arr-ladder",
        new Date(now - 2 * HOUR),
        new Date(now + HOUR),
        [66, 70, 74, 78],
        new Date(now + 2 * HOUR),
      ),
    );
    await openQuestion(postgres.db, "arr-ladder");
    await submitForecast(postgres.db, {
      slug: "arr-ladder",
      userId: users[0]!,
      probs: [0, 0, 0.5, 0.5, 0, 0],
    });
    await postgres.db
      .updateTable("tournament_questions")
      .set({ closes_at: new Date(now - HOUR) })
      .where("slug", "=", "arr-ladder")
      .execute();
    const base = {
      rung_fired: 1,
      source_url: "https://www.sec.gov/",
      source_excerpt: "Run-rate revenue",
      note_md: "Rung 1.",
    };
    const floor = { ...base, resolved_value: null, rung_fired: null, winning_bucket_index: 5 };
    await expect(
      resolveQuestion(postgres.db, "arr-ladder", floor, users[0]!),
    ).rejects.toMatchObject({ code: "QUESTION_STATE" });
    await expect(
      resolveQuestion(
        postgres.db,
        "arr-ladder",
        { ...base, resolved_value: 74, winning_bucket_index: 2 },
        users[0]!,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", details: { computedWinningBucketIndex: 3 } });
    const outcome = await resolveQuestion(
      postgres.db,
      "arr-ladder",
      { ...base, resolved_value: 74, winning_bucket_index: 3 },
      users[0]!,
    );
    expect(outcome.winningBucketIndex).toBe(3);

    // Closed early on its document, which carried no figure: the floor resolves before expiry.
    await saveDraftQuestion(
      postgres.db,
      ladder("no-figure", new Date(now - HOUR), new Date(now + HOUR), [66, 70]),
    );
    await openQuestion(postgres.db, "no-figure");
    await closeQuestion(postgres.db, "no-figure", {});
    const early = await resolveQuestion(
      postgres.db,
      "no-figure",
      { ...floor, winning_bucket_index: 3 },
      users[0]!,
    );
    expect(early.winningBucketIndex).toBe(3);
  });

  it("resolves a choice question by bucket and holds its floor until expiry", async () => {
    const now = Date.now();
    await saveDraftQuestion(postgres.db, {
      slug: "race",
      title: "Which comes first?",
      description_md: "Description.",
      rulebook_md: "Rulebook.",
      rulebook_version: 1,
      unit: "choice",
      opens_at: new Date(now - HOUR).toISOString(),
      closes_at: new Date(now + HOUR).toISOString(),
      expiry_at: new Date(now + HOUR).toISOString(),
      outcomes: { labels: ["A first", "B first"], floor_label: "Neither" },
    });
    await openQuestion(postgres.db, "race");
    for (const userId of users) {
      await submitForecast(postgres.db, { slug: "race", userId, probs: [0.6, 0.3, 0.1] });
    }
    const open = await getQuestion(postgres.db, "race");
    expect(open.buckets.map((bucket) => bucket.kind)).toEqual(["range", "range", "floor"]);
    expect(open.aggregate!.medianValue).toBeNull();
    expect(open.aggregate!.pYes).toBeNull();
    expect(open.aggregate!.pFloor).toBeGreaterThan(0);

    await closeQuestion(postgres.db, "race", {});
    const base = {
      rung_fired: null,
      source_url: "https://example.com/",
      source_excerpt: "Shares began trading",
      note_md: "B printed first.",
    };
    await expect(
      resolveQuestion(
        postgres.db,
        "race",
        { ...base, resolved_value: 1, winning_bucket_index: 1 },
        users[0]!,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      resolveQuestion(
        postgres.db,
        "race",
        { ...base, resolved_value: null, winning_bucket_index: 2 },
        users[0]!,
      ),
    ).rejects.toMatchObject({ code: "QUESTION_STATE" });
    const outcome = await resolveQuestion(
      postgres.db,
      "race",
      { ...base, resolved_value: null, winning_bucket_index: 1 },
      users[0]!,
    );
    expect(outcome.winningBucketIndex).toBe(1);
    expect((await verifyTournament(postgres.db)).passed).toBe(true);
  });

  it("drops flagged accounts from the aggregate", async () => {
    const now = Date.now();
    await saveDraftQuestion(
      postgres.db,
      ladder("anthropic-ipo-day1-mcap", new Date(now - HOUR), new Date(now + HOUR), [1, 2]),
    );
    await openQuestion(postgres.db, "anthropic-ipo-day1-mcap");
    for (const userId of users) {
      await submitForecast(postgres.db, {
        slug: "anthropic-ipo-day1-mcap",
        userId,
        probs: [0, 1, 0, 0],
      });
    }
    const before = await getQuestion(postgres.db, "anthropic-ipo-day1-mcap");
    expect(before.aggregate!.nForecasters).toBe(6);
    expect(before.aggregate!.medianValue).toBeGreaterThan(1);
    expect(before.aggregate!.medianValue).toBeLessThan(2);

    const flagged = await setUserFlag(postgres.db, {
      handle: "forecaster5",
      flagged: true,
      reason: "Sock puppet",
    });
    expect(flagged.recomputed).toBe(1);
    const question = await getQuestion(postgres.db, "anthropic-ipo-day1-mcap");
    expect(question.aggregate!.nForecasters).toBe(5);
  });

  it("accepts a forecast through the route with a session and reports the viewer", async () => {
    await openBinary();
    const token = await createTournamentSession(postgres.db, users[0]!);
    const response = await forecastRoute(
      new Request(`${APP_ORIGIN}/api/t/questions/binary-q/forecasts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: APP_ORIGIN,
          cookie: `${TOURNAMENT_SESSION_COOKIE}=${token}`,
        },
        body: JSON.stringify({ probs: [0.25, 0.75] }),
      }),
      { params: Promise.resolve({ slug: "binary-q" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ probs: [0.25, 0.75], questionSlug: "binary-q" });

    const anonymous = await forecastRoute(
      new Request(`${APP_ORIGIN}/api/t/questions/binary-q/forecasts`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_ORIGIN },
        body: JSON.stringify({ probs: [0.25, 0.75] }),
      }),
      { params: Promise.resolve({ slug: "binary-q" }) },
    );
    expect(anonymous.status).toBe(401);

    const me = await meRoute(
      new Request(`${APP_ORIGIN}/api/t/me`, {
        headers: { cookie: `${TOURNAMENT_SESSION_COOKIE}=${token}` },
      }),
    );
    const body = (await me.json()) as {
      viewer: { identity: { handle: string }; forecasts: Record<string, unknown> };
      isAdmin: boolean;
    };
    expect(body.viewer.identity.handle).toBe("Forecaster0");
    expect(Object.keys(body.viewer.forecasts)).toEqual(["binary-q"]);
    expect(body.isAdmin).toBe(false);
  });
});
