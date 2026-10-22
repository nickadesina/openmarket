import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuestionInput } from "../../src/lib/api/tournament-schemas.js";
import {
  createTournamentSession,
  TOURNAMENT_SESSION_COOKIE,
} from "../../src/lib/auth/tournament-session.js";
import { DISPUTE_WINDOW_MS } from "../../src/lib/config/tournament.js";
import { aggregateBinary, aggregateForward } from "../../src/lib/engine/tournament/aggregate.js";
import {
  binaryScore,
  forwardScore,
  timeAveragedScore,
} from "../../src/lib/engine/tournament/score.js";
import {
  closeQuestion,
  openQuestion,
  resolveQuestion,
  saveDraftQuestion,
  setUserFlag,
  voidQuestion,
  voidQuestionIn,
} from "../../src/lib/services/tournament/admin.js";
import { getForecaster } from "../../src/lib/services/tournament/forecaster.js";
import {
  getQuestion,
  listLatestForecasts,
  listQuestions,
} from "../../src/lib/services/tournament/get-question.js";
import {
  getLeaderboard,
  listLeaderboardPeriods,
} from "../../src/lib/services/tournament/leaderboard.js";
import { upsertIdentity } from "../../src/lib/services/tournament/sign-in.js";
import {
  forecastEventHash,
  submitForecast,
} from "../../src/lib/services/tournament/submit-forecast.js";
import { verifyTournament } from "../../src/lib/services/tournament/verify-tournament.js";
import { seedFixtureListings } from "./dealer-fixture.js";
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

const SOURCE = {
  rung_fired: 1,
  source_url: "https://www.sec.gov/edgar",
  source_excerpt: "Final prospectus",
  note_md: "Resolved.",
};

function binary(slug: string, opensAt: Date, closesAt: Date): QuestionInput {
  return {
    slug,
    title: `Binary ${slug}`,
    description_md: "Description.",
    rulebook_md: "Rulebook.",
    rulebook_version: 1,
    kind: "binary",
    opens_at: opensAt.toISOString(),
    closes_at: closesAt.toISOString(),
  };
}

function forward(
  slug: string,
  opensAt: Date,
  closesAt: Date,
  expiresAt: Date = closesAt,
): QuestionInput {
  return {
    slug,
    title: `Forward ${slug}`,
    description_md: "Description.",
    rulebook_md: "Rulebook.",
    rulebook_version: 1,
    kind: "forward",
    unit: "USD_B",
    opens_at: opensAt.toISOString(),
    closes_at: closesAt.toISOString(),
    expiry_at: expiresAt.toISOString(),
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

  async function openForward(slug = "forward-q"): Promise<void> {
    const now = Date.now();
    await saveDraftQuestion(
      postgres.db,
      forward(slug, new Date(now - HOUR), new Date(now + HOUR), new Date(now + 2 * HOUR)),
    );
    await openQuestion(postgres.db, slug);
  }

  async function questionRow(slug: string) {
    return postgres.db
      .selectFrom("tournament_questions")
      .select(["id", "opens_at"])
      .where("slug", "=", slug)
      .executeTakeFirstOrThrow();
  }

  /** A back-dated event with its real hash, so the scorer has a known timeline and verify passes. */
  async function insertEvent(
    questionId: string,
    userId: string,
    at: number,
    forecast: { readonly p: number | null; readonly value: number | null },
  ): Promise<void> {
    const submittedAt = new Date(at);
    await postgres.db
      .insertInto("tournament_forecast_events")
      .values({
        user_id: userId,
        question_id: questionId,
        submitted_at: submittedAt,
        p: forecast.p === null ? null : forecast.p.toFixed(10),
        value: forecast.value === null ? null : forecast.value.toFixed(10),
        event_hash: forecastEventHash(questionId, userId, submittedAt, forecast),
      })
      .execute();
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

  it("hides drafts, pins a question once open, and stores each kind's shape", async () => {
    const now = Date.now();
    const input = binary("pinned", new Date(now - HOUR), new Date(now + HOUR));
    const saved = await saveDraftQuestion(postgres.db, input);
    expect(saved).toEqual({ slug: "pinned", status: "draft", kind: "binary" });
    expect(await listQuestions(postgres.db)).toHaveLength(0);
    await saveDraftQuestion(postgres.db, { ...input, title: "Edited draft" });
    await openQuestion(postgres.db, "pinned");
    expect((await listQuestions(postgres.db))[0]).toMatchObject({
      title: "Edited draft",
      kind: "binary",
      unit: null,
      expiryAt: new Date(input.closes_at).toISOString(),
      instrument: null,
    });
    await expect(saveDraftQuestion(postgres.db, input)).rejects.toMatchObject({
      code: "QUESTION_STATE",
    });

    await openForward();
    const detail = await getQuestion(postgres.db, "forward-q");
    expect(detail).toMatchObject({ kind: "forward", unit: "USD_B", aggregate: null });
    expect(detail.rules.clampScore).toBeCloseTo(-896.578, 3);
    await expect(
      saveDraftQuestion(
        postgres.db,
        forward("backwards", new Date(now - HOUR), new Date(now + HOUR), new Date(now)),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("validates, rate-limits, and publishes the binary crowd only from five forecasters", async () => {
    await openBinary();
    await expect(
      submitForecast(postgres.db, { slug: "binary-q", userId: users[0]!, value: 0.5 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      submitForecast(postgres.db, { slug: "binary-q", userId: users[0]!, p: 1 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const ps = [0.7, 0.6, 0.8, 0.55, 0.9];
    for (let index = 0; index < 4; index += 1) {
      await submitForecast(postgres.db, { slug: "binary-q", userId: users[index]!, p: ps[index]! });
    }
    let question = await getQuestion(postgres.db, "binary-q");
    expect(question.aggregate).toMatchObject({
      nForecasters: 4,
      published: false,
      p: null,
      value: null,
    });

    const stored = await submitForecast(postgres.db, {
      slug: "binary-q",
      userId: users[4]!,
      p: ps[4]!,
    });
    expect(stored).toMatchObject({ p: 0.9, value: null });
    expect(stored.eventHash).toMatch(/^[0-9a-f]{64}$/);
    question = await getQuestion(postgres.db, "binary-q");
    expect(question.aggregate!.published).toBe(true);
    expect(question.aggregate!.p).toBeCloseTo(aggregateBinary(ps, 1.5)!, 9);
    expect(question.aggregate!.value).toBeNull();

    const listed = await listLatestForecasts(postgres.db, "binary-q");
    expect(listed.forecasts.map((forecast) => forecast.p).sort()).toEqual([...ps].sort());

    await expect(
      submitForecast(postgres.db, { slug: "binary-q", userId: users[0]!, p: 0.1 }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(await verifyTournament(postgres.db)).toMatchObject({ passed: true, findings: [] });
  });

  it("publishes the forward crowd as the median ln level, in the unit", async () => {
    await openForward();
    await expect(
      submitForecast(postgres.db, { slug: "forward-q", userId: users[0]!, p: 0.5 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      submitForecast(postgres.db, { slug: "forward-q", userId: users[0]!, value: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const levels = [380, 412.5, 450, 300, 1_200];
    for (let index = 0; index < levels.length; index += 1) {
      await submitForecast(postgres.db, {
        slug: "forward-q",
        userId: users[index]!,
        value: levels[index]!,
      });
    }
    const question = await getQuestion(postgres.db, "forward-q");
    expect(question.aggregate).toMatchObject({ nForecasters: 5, published: true, p: null });
    expect(question.aggregate!.value).toBeCloseTo(aggregateForward(levels)!, 9);
    expect(question.aggregate!.value).toBeCloseTo(412.5, 9);
    const viewer = await getForecaster(postgres.db, "forecaster1");
    expect(viewer.open[0]).toMatchObject({ kind: "forward", unit: "USD_B", p: null, value: 412.5 });
    expect(await verifyTournament(postgres.db)).toMatchObject({ passed: true, findings: [] });
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
      submitForecast(postgres.db, { slug: "binary-q", userId: young, p: 0.5 }),
    ).rejects.toMatchObject({ code: "ACCOUNT_TOO_NEW" });
  });

  it("closes, resolves a binary by outcome, scores, supersedes in the dispute window, and ranks", async () => {
    await openBinary();
    const row = await questionRow("binary-q");
    const opensAt = row.opens_at.getTime();
    const timeline = [
      { user: 0, at: opensAt, p: 0.9 },
      { user: 1, at: opensAt + HOUR / 2, p: 0.2 },
      { user: 0, at: opensAt + HOUR / 2, p: 0.6 },
    ];
    for (const event of timeline) {
      await insertEvent(row.id, users[event.user]!, event.at, { p: event.p, value: null });
    }

    const yes = { ...SOURCE, outcome: "yes" as const };
    await expect(resolveQuestion(postgres.db, "binary-q", yes, users[0]!)).rejects.toMatchObject({
      code: "QUESTION_STATE",
    });

    const { closedAt } = await closeQuestion(postgres.db, "binary-q", {});
    await expect(
      submitForecast(postgres.db, { slug: "binary-q", userId: users[2]!, p: 0.5 }),
    ).rejects.toMatchObject({ code: "QUESTION_NOT_OPEN" });
    await expect(
      resolveQuestion(postgres.db, "binary-q", { ...SOURCE, resolved_value: 1 }, users[0]!),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const outcome = await resolveQuestion(postgres.db, "binary-q", yes, users[0]!);
    expect(outcome).toMatchObject({ outcome: "yes", resolvedValue: null, scoresWritten: 2 });

    const end = new Date(closedAt).getTime();
    const expectedFirst = timeAveragedScore({
      opensAt,
      closesAt: end,
      forecasts: timeline
        .filter((event) => event.user === 0)
        .map((event) => ({ at: event.at, forecast: event.p })),
      score: (p: number) => binaryScore(p, "yes"),
    })!;
    let board = await getLeaderboard(postgres.db, "all");
    expect(board.entries.map((entry) => entry.handle)).toEqual(["Forecaster0", "Forecaster1"]);
    expect(board.entries[0]!.totalScore).toBeCloseTo(expectedFirst.timeAvgLogScore, 9);
    expect(board.entries[0]!.rank).toBe(1);

    const detail = await getQuestion(postgres.db, "binary-q");
    expect(detail.status).toBe("resolved");
    expect(detail.resolution).toMatchObject({ outcome: "yes", resolvedValue: null });
    expect(detail.resolutionDetail).toMatchObject({ outcome: "yes", rungFired: 1 });
    expect(detail.resolutionDetail!.topForecasters).toHaveLength(2);
    expect(detail.resolutionDetail!.finalAggregate).toMatchObject({
      nForecasters: 2,
      published: false,
      p: null,
    });
    // The back-dated events left no aggregate inside the window.
    expect(detail.resolutionDetail!.aggregateScore).toBeNull();
    expect(detail.rules.minPublishedForecasters).toBe(5);

    // A dispute inside the window replaces the live row and rescoring follows it.
    const corrected = await resolveQuestion(
      postgres.db,
      "binary-q",
      { ...SOURCE, outcome: "no", note_md: "Corrected: a DRS, not an S-1." },
      users[0]!,
    );
    expect(corrected.supersededResolutionId).toBe(outcome.resolutionId);
    board = await getLeaderboard(postgres.db, "all");
    expect(board.entries[0]!.handle).toBe("Forecaster1");
    expect((await getQuestion(postgres.db, "binary-q")).resolutionDetail!.supersededCount).toBe(1);

    expect(await verifyTournament(postgres.db)).toMatchObject({ passed: true, findings: [] });

    const positions = await getForecaster(postgres.db, "forecaster1");
    expect(positions.resolved).toHaveLength(1);
    expect(positions.resolved[0]).toMatchObject({ kind: "binary", outcome: "no" });

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

  it("resolves a forward to its settling value and scores the level", async () => {
    await openForward();
    const row = await questionRow("forward-q");
    const opensAt = row.opens_at.getTime();
    const timeline = [
      { user: 0, at: opensAt, value: 400 },
      { user: 1, at: opensAt, value: 100 },
      { user: 2, at: opensAt + HOUR / 2, value: 800 },
      { user: 1, at: opensAt + HOUR / 2, value: 440 },
    ];
    for (const event of timeline) {
      await insertEvent(row.id, users[event.user]!, event.at, { p: null, value: event.value });
    }
    const { closedAt } = await closeQuestion(postgres.db, "forward-q", {});
    await expect(
      resolveQuestion(postgres.db, "forward-q", { ...SOURCE, outcome: "yes" }, users[0]!),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const outcome = await resolveQuestion(
      postgres.db,
      "forward-q",
      { ...SOURCE, resolved_value: 400 },
      users[0]!,
    );
    expect(outcome).toMatchObject({ outcome: null, resolvedValue: 400, scoresWritten: 3 });

    const end = new Date(closedAt).getTime();
    const expected = (user: number) =>
      timeAveragedScore({
        opensAt,
        closesAt: end,
        forecasts: timeline
          .filter((event) => event.user === user)
          .map((event) => ({ at: event.at, forecast: event.value })),
        score: (x: number) => forwardScore(x, 400),
      })!;
    const board = await getLeaderboard(postgres.db, "all");
    expect(board.entries.map((entry) => entry.handle)).toEqual([
      "Forecaster0",
      "Forecaster2",
      "Forecaster1",
    ]);
    expect(board.entries[0]!.totalScore).toBeCloseTo(100, 9);
    // Half the window unforecast (0), half at a 2× miss (0).
    expect(board.entries[1]!.totalScore).toBeCloseTo(0, 9);
    // Half the window 4× low (−100), then 10% high (≈ 86).
    expect(board.entries[2]!.totalScore).toBeCloseTo(expected(1).timeAvgLogScore, 9);
    expect(expected(1).timeAvgLogScore).toBeLessThan(0);

    const detail = await getQuestion(postgres.db, "forward-q");
    expect(detail.resolution).toMatchObject({ outcome: null, resolvedValue: 400 });
    expect(detail.resolutionDetail!.finalAggregate).toMatchObject({ nForecasters: 3 });
    const positions = await getForecaster(postgres.db, "forecaster0");
    expect(positions.resolved[0]).toMatchObject({
      kind: "forward",
      unit: "USD_B",
      outcome: null,
      resolvedValue: 400,
    });
    expect(positions.resolved[0]!.timeAvgLogScore).toBeCloseTo(100, 9);
    expect(await verifyTournament(postgres.db)).toMatchObject({ passed: true, findings: [] });
  });

  it("voids a forward without scoring and refuses to resolve a voided question", async () => {
    await openForward();
    await submitForecast(postgres.db, { slug: "forward-q", userId: users[0]!, value: 400 });
    await closeQuestion(postgres.db, "forward-q", {});
    await voidQuestion(postgres.db, "forward-q", { note_md: "No figure in the 424(b)." });
    await expect(
      resolveQuestion(postgres.db, "forward-q", { ...SOURCE, resolved_value: 400 }, users[0]!),
    ).rejects.toMatchObject({ code: "QUESTION_STATE" });
    await expect(
      voidQuestion(postgres.db, "forward-q", { note_md: "Again." }),
    ).rejects.toMatchObject({ code: "QUESTION_STATE" });
    const scores = await postgres.db.selectFrom("tournament_scores").selectAll().execute();
    expect(scores).toHaveLength(0);
    expect((await getLeaderboard(postgres.db, "all")).entries).toHaveLength(0);
    expect(await getQuestion(postgres.db, "forward-q")).toMatchObject({
      status: "voided",
      voidNoteMd: "No figure in the 424(b).",
      resolution: null,
    });
    expect(await verifyTournament(postgres.db)).toMatchObject({ passed: true, findings: [] });
  });

  it("voids a resolved question inside the dispute window, and only inside it", async () => {
    await openForward();
    await submitForecast(postgres.db, { slug: "forward-q", userId: users[0]!, value: 400 });
    await closeQuestion(postgres.db, "forward-q", {});
    const outcome = await resolveQuestion(
      postgres.db,
      "forward-q",
      { ...SOURCE, resolved_value: 400 },
      users[0]!,
    );
    expect(outcome.scoresWritten).toBe(1);
    expect((await getLeaderboard(postgres.db, "all")).entries).toHaveLength(1);

    await voidQuestion(postgres.db, "forward-q", {
      note_md: "The figure was not the KPI the rulebook names: void.",
    });
    expect((await getLeaderboard(postgres.db, "all")).entries).toHaveLength(0);
    expect(await listLeaderboardPeriods(postgres.db)).toEqual(["all"]);
    const resolution = await postgres.db
      .selectFrom("tournament_resolutions")
      .select(["id", "superseded_by"])
      .executeTakeFirstOrThrow();
    expect(resolution.superseded_by).toBe(resolution.id);
    expect(await getQuestion(postgres.db, "forward-q")).toMatchObject({
      status: "voided",
      resolution: null,
      resolutionDetail: null,
    });
    expect((await getForecaster(postgres.db, "forecaster0")).resolved).toHaveLength(0);
    expect(await verifyTournament(postgres.db)).toMatchObject({ passed: true, findings: [] });

    // Past the window, the resolution is final.
    await openBinary();
    await submitForecast(postgres.db, { slug: "binary-q", userId: users[0]!, p: 0.7 });
    await closeQuestion(postgres.db, "binary-q", {});
    await resolveQuestion(postgres.db, "binary-q", { ...SOURCE, outcome: "yes" }, users[0]!);
    const late = new Date(Date.now() + DISPUTE_WINDOW_MS + HOUR);
    await expect(
      postgres.db
        .transaction()
        .execute((transaction) =>
          voidQuestionIn(transaction, "binary-q", { note_md: "Too late." }, late),
        ),
    ).rejects.toMatchObject({ code: "QUESTION_STATE" });
    expect((await getQuestion(postgres.db, "binary-q")).status).toBe("resolved");
  });

  it("sums both kinds on the leaderboard", async () => {
    await openBinary();
    await openForward();
    await submitForecast(postgres.db, { slug: "binary-q", userId: users[0]!, p: 0.8 });
    await submitForecast(postgres.db, { slug: "forward-q", userId: users[0]!, value: 300 });
    await submitForecast(postgres.db, { slug: "binary-q", userId: users[1]!, p: 0.3 });
    await closeQuestion(postgres.db, "binary-q", {});
    await closeQuestion(postgres.db, "forward-q", {});
    await resolveQuestion(postgres.db, "binary-q", { ...SOURCE, outcome: "yes" }, users[0]!);
    await resolveQuestion(postgres.db, "forward-q", { ...SOURCE, resolved_value: 400 }, users[0]!);

    const scores = await postgres.db
      .selectFrom("tournament_scores")
      .select(["question_id", "time_avg_log_score"])
      .where("user_id", "=", users[0]!)
      .execute();
    expect(scores).toHaveLength(2);
    const board = await getLeaderboard(postgres.db, "all");
    const first = board.entries.find((entry) => entry.handle === "Forecaster0")!;
    expect(first.questionsResolved).toBe(2);
    expect(first.totalScore).toBeCloseTo(
      scores.reduce((sum, score) => sum + score.time_avg_log_score, 0),
      9,
    );
    const profile = await getForecaster(postgres.db, "forecaster0");
    expect(profile.resolved.map((position) => position.kind).sort()).toEqual(["binary", "forward"]);
    expect(profile.totalScore).toBeCloseTo(first.totalScore, 9);
    expect(await verifyTournament(postgres.db)).toMatchObject({ passed: true, findings: [] });
  });

  it("drops flagged accounts from the aggregate", async () => {
    await openForward("anthropic-ipo-day1-mcap");
    for (const userId of users) {
      await submitForecast(postgres.db, { slug: "anthropic-ipo-day1-mcap", userId, value: 1.5 });
    }
    const before = await getQuestion(postgres.db, "anthropic-ipo-day1-mcap");
    expect(before.aggregate!.nForecasters).toBe(6);
    expect(before.aggregate!.value).toBeCloseTo(1.5, 9);

    const flagged = await setUserFlag(postgres.db, {
      handle: "forecaster5",
      flagged: true,
      reason: "Sock puppet",
    });
    expect(flagged.recomputed).toBe(1);
    const question = await getQuestion(postgres.db, "anthropic-ipo-day1-mcap");
    expect(question.aggregate!.nForecasters).toBe(5);
    expect(await verifyTournament(postgres.db)).toMatchObject({ passed: true, findings: [] });
  });

  it("shows a linked question's instrument with its latest price", async () => {
    await seedFixtureListings(postgres.db, new Date("2026-09-01T00:00:00Z"));
    const listing = await postgres.db
      .selectFrom("listings")
      .innerJoin("companies", "companies.id", "listings.company_id")
      .select(["listings.id", "companies.slug"])
      .orderBy("companies.slug")
      .executeTakeFirstOrThrow();
    await openBinary();
    await openForward();
    const now = Date.now();
    const instrumentFor = async (kind: "binary" | "forward") =>
      (
        await postgres.db
          .insertInto("instruments")
          .values({
            listing_id: listing.id,
            kind,
            epoch: 1,
            question: `${kind} question`,
            opens_at: new Date(now - HOUR),
            expires_at: new Date(now + 2 * HOUR),
            state: "quoting",
          })
          .returning("id")
          .executeTakeFirstOrThrow()
      ).id;
    const binaryId = await instrumentFor("binary");
    const forwardId = await instrumentFor("forward");
    const quote = {
      reason: "list" as const,
      inventory_cents: "0",
      cap_cents_effective: "0",
      flag_state: "normal" as const,
      model_version: "test",
      rulebook_version: "test",
    };
    await postgres.db
      .insertInto("quotes")
      .values([
        { ...quote, instrument_id: binaryId, posted_at: new Date(now - HOUR), price: 0.3 },
        { ...quote, instrument_id: binaryId, posted_at: new Date(now - 1_000), price: 0.385 },
        {
          ...quote,
          instrument_id: forwardId,
          posted_at: new Date(now - 1_000),
          mid_ln: Math.log(4.12e11),
          bid_ln: Math.log(4e11),
          ask_ln: Math.log(4.2e11),
        },
      ])
      .execute();
    for (const [slug, instrumentId] of [
      ["binary-q", binaryId],
      ["forward-q", forwardId],
    ] as const) {
      const row = await questionRow(slug);
      await postgres.db
        .insertInto("tournament_instrument_links")
        .values({ question_id: row.id, instrument_id: instrumentId })
        .execute();
    }

    expect((await getQuestion(postgres.db, "binary-q")).instrument).toEqual({
      kind: "binary",
      companySlug: listing.slug,
      yesPrice: 0.385,
      midUsd: null,
    });
    const linkedForward = (await listQuestions(postgres.db)).find(
      (question) => question.slug === "forward-q",
    )!;
    expect(linkedForward.instrument).toMatchObject({
      kind: "forward",
      companySlug: listing.slug,
      yesPrice: null,
    });
    expect(linkedForward.instrument!.midUsd).toBeCloseTo(4.12e11, 0);
  });

  it("accepts a forecast through the route with a session and reports the viewer", async () => {
    await openBinary();
    await openForward();
    const token = await createTournamentSession(postgres.db, users[0]!);
    const post = (slug: string, body: unknown, cookie = true) =>
      forecastRoute(
        new Request(`${APP_ORIGIN}/api/t/questions/${slug}/forecasts`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: APP_ORIGIN,
            ...(cookie ? { cookie: `${TOURNAMENT_SESSION_COOKIE}=${token}` } : {}),
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ slug }) },
      );

    const response = await post("binary-q", { p: 0.25 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      p: 0.25,
      value: null,
      questionSlug: "binary-q",
    });
    const level = await post("forward-q", { value: 412.5 });
    expect(level.status).toBe(200);
    expect(await level.json()).toMatchObject({ p: null, value: 412.5 });
    expect((await post("binary-q", { probs: [0.25, 0.75] })).status).toBe(400);
    expect((await post("forward-q", { value: -1 })).status).toBe(400);
    expect((await post("binary-q", { p: 0.25 }, false)).status).toBe(401);

    const me = await meRoute(
      new Request(`${APP_ORIGIN}/api/t/me`, {
        headers: { cookie: `${TOURNAMENT_SESSION_COOKIE}=${token}` },
      }),
    );
    const body = (await me.json()) as {
      viewer: {
        identity: { handle: string };
        forecasts: Record<string, { p: number | null; value: number | null }>;
      };
      isAdmin: boolean;
    };
    expect(body.viewer.identity.handle).toBe("Forecaster0");
    expect(body.viewer.forecasts).toMatchObject({
      "binary-q": { p: 0.25, value: null },
      "forward-q": { p: null, value: 412.5 },
    });
    expect(body.isAdmin).toBe(false);
  });
});
