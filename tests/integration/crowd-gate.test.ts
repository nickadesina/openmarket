import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { BLEND_SCHEDULE } from "../../src/lib/engine/dealer/blend.js";
import type { ReferenceComponents } from "../../src/lib/services/dealer/reference-prices.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { verifyDealer } from "../../src/lib/services/dealer/verify-dealer.js";
import { submitForecast } from "../../src/lib/services/tournament/submit-forecast.js";
import { verifyReplay } from "../../src/lib/services/verify-replay.js";
import { seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  createTrader,
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

import { GET as referenceRoute } from "../../src/app/api/ref/[slug]/route.js";

/**
 * Milestone 7's gate: the crowd weight appears in the published reference
 * once a linked question has ten forecasters, and not at nine. One name is
 * listed on the wall clock (the other four are delisted before the dealer
 * runs), forecasters are development-provider accounts (no external account
 * age, so the question's age rule admits them), and every forecast goes
 * through the tournament's own submit-forecast service.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Crowd gate PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Crowd gate PostgreSQL integration";

const SLUG = "anthropic";

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
    runtime.getRuntimeDatabase.mockImplementation(() => postgres.db);
  }, 30_000);

  beforeEach(async () => {
    vi.stubEnv("TOURNAMENT_LINKED_QUESTIONS", "1");
    await resetPostgresTestDatabase(postgres.db);
    const listedAt = new Date(Date.now() - 60_000);
    await seedFixtureListings(postgres.db, listedAt);
    const others = await postgres.db
      .selectFrom("listings")
      .innerJoin("companies", "companies.id", "listings.company_id")
      .select("listings.id")
      .where("companies.slug", "<>", SLUG)
      .execute();
    await postgres.db
      .updateTable("listings")
      .set({ delisted_at: new Date(listedAt.getTime() + 1) })
      .where(
        "id",
        "in",
        others.map((row) => row.id),
      )
      .execute();
    await runDealerJob(postgres.db, "gate-list", new Date());
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  async function linkedQuestions() {
    const rows = await postgres.db
      .selectFrom("tournament_instrument_links as links")
      .innerJoin("instruments", "instruments.id", "links.instrument_id")
      .innerJoin("tournament_questions as questions", "questions.id", "links.question_id")
      .select([
        "instruments.kind",
        "instruments.listing_id",
        "questions.id",
        "instruments.id as instrument_id",
        "questions.id",
        "questions.slug",
        "questions.kind as question_kind",
        "questions.unit",
      ])
      .orderBy("instruments.kind")
      .execute();
    expect(rows.map((row) => row.kind)).toEqual(["binary", "forward"]);
    expect(rows.map((row) => row.question_kind)).toEqual(["binary", "forward"]);
    return { binary: rows[0]!, forward: rows[1]! };
  }

  function unitScale(unit: string | null): number {
    return unit === "USD_T" ? 1e12 : 1e9;
  }

  /** The forward's listing mid in its question's unit, so the levels sit where the model does. */
  async function midInUnit(instrumentId: string, unit: string | null): Promise<number> {
    const mid = await postgres.db
      .selectFrom("model_mids")
      .select("mid_ln")
      .where("instrument_id", "=", instrumentId)
      .orderBy("computed_at")
      .executeTakeFirstOrThrow();
    return Math.exp(mid.mid_ln!) / unitScale(unit);
  }

  /** Forecaster i's level: a spread from 0.8× to 1.25× the listing mid, rounded to 3 dp. */
  function levelOf(index: number, mid: number): number {
    return Number((mid * (0.8 + index * 0.05)).toFixed(3));
  }

  /** Forecaster i: a spread of P(yes), and a spread of levels around the listing mid. */
  async function forecast(index: number) {
    const { binary, forward } = await linkedQuestions();
    const trader = await createTrader(postgres.db, `crowd_${index}`);
    await submitForecast(postgres.db, {
      slug: binary.slug,
      userId: trader.tournamentUserId,
      p: 0.2 + index * 0.05,
    });
    await submitForecast(postgres.db, {
      slug: forward.slug,
      userId: trader.tournamentUserId,
      value: levelOf(index, await midInUnit(forward.instrument_id, forward.unit)),
    });
  }

  /** The median of ln(level in USD) over forecasters 0..n−1: the mean of the two middle when n is even. */
  async function medianLnUsd(n: number): Promise<number> {
    const { forward } = await linkedQuestions();
    const mid = await midInUnit(forward.instrument_id, forward.unit);
    const logs = Array.from({ length: n }, (_, index) =>
      Math.log(levelOf(index, mid) * unitScale(forward.unit)),
    ).sort((left, right) => left - right);
    const half = Math.floor(n / 2);
    return n % 2 === 1 ? logs[half]! : (logs[half - 1]! + logs[half]!) / 2;
  }

  async function latestReference(listingId: string, kind: "binary" | "forward") {
    return postgres.db
      .selectFrom("reference_prices")
      .selectAll()
      .where("listing_id", "=", listingId)
      .where("kind", "=", kind)
      .orderBy("as_of", "desc")
      .orderBy("id", "desc")
      .executeTakeFirstOrThrow();
  }

  async function latestAggregate(questionId: string) {
    return postgres.db
      .selectFrom("tournament_aggregates")
      .selectAll()
      .where("question_id", "=", questionId)
      .orderBy("computed_at", "desc")
      .orderBy("id", "desc")
      .executeTakeFirstOrThrow();
  }

  it("gives the crowd no weight at nine forecasters and w_c = 0.3 at ten", async () => {
    const { binary, forward } = await linkedQuestions();
    expect(await postgres.db.selectFrom("listings").select("id").execute()).toHaveLength(5);
    for (let index = 0; index < 9; index += 1) await forecast(index);

    const nine = await runDealerJob(postgres.db, "gate-ref-9", new Date());
    expect(nine.status).toBe("succeeded");
    for (const kind of ["binary", "forward"] as const) {
      const row = await latestReference(binary.listing_id, kind);
      expect(row).toMatchObject({ w_crowd: 0, w_model: 1 });
    }
    const nineAggregate = await latestAggregate(binary.id);
    expect(nineAggregate.n_forecasters).toBe(9);

    await forecast(9);
    const ten = await runDealerJob(postgres.db, "gate-ref-10", new Date());
    expect(ten.status === "succeeded" && ten.result.steps.reference.written).toHaveLength(2);

    const hazard = await latestReference(binary.listing_id, "binary");
    const hazardAggregate = await latestAggregate(binary.id);
    expect(hazardAggregate.n_forecasters).toBe(10);
    const hazardComponents = hazard.components_json as unknown as ReferenceComponents;
    expect(hazard.w_crowd).toBe(BLEND_SCHEDULE.crowd.max_weight);
    expect(hazard.w_model).toBeCloseTo(1 - BLEND_SCHEDULE.crowd.max_weight, 15);
    expect(hazardAggregate.value).toBeNull();
    expect(hazardComponents.crowd).toEqual({
      question_id: binary.id,
      aggregate_id: hazardAggregate.id,
      computed_at: hazardAggregate.computed_at.toISOString(),
      n_forecasters: 10,
      kind: "binary",
      unit: null,
      reported: Number(hazardAggregate.p),
      value: Number(hazardAggregate.p),
    });
    expect(hazard.value).toBeCloseTo(
      0.7 * hazardComponents.model.value + 0.3 * Number(hazardAggregate.p),
      12,
    );

    const reference = await latestReference(forward.listing_id, "forward");
    const forwardAggregate = await latestAggregate(forward.id);
    expect(forwardAggregate.p).toBeNull();
    const crowdLn = Math.log(Number(forwardAggregate.value) * unitScale(forward.unit));
    const forwardComponents = reference.components_json as unknown as ReferenceComponents;
    expect(reference.w_crowd).toBe(BLEND_SCHEDULE.crowd.max_weight);
    expect(forwardComponents.crowd).toMatchObject({
      question_id: forward.id,
      aggregate_id: forwardAggregate.id,
      n_forecasters: 10,
      kind: "forward",
      unit: forward.unit,
      reported: Number(forwardAggregate.value),
    });
    expect(forwardComponents.crowd!.value).toBeCloseTo(crowdLn, 12);
    // The crowd is the median of the ten forecasters' ln levels.
    expect(forwardComponents.crowd!.value).toBeCloseTo(await medianLnUsd(10), 9);
    expect(reference.value).toBeCloseTo(0.7 * forwardComponents.model.value + 0.3 * crowdLn, 12);

    // The public reference shows the crowd component and its weight.
    const response = await referenceRoute(new Request(`https://openmkt.test/api/ref/${SLUG}`), {
      params: Promise.resolve({ slug: SLUG }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reference_hazard).toMatchObject({
      model_only: false,
      weights: { crowd: BLEND_SCHEDULE.crowd.max_weight },
      components: { crowd: { n_forecasters: 10, aggregate_id: hazardAggregate.id } },
    });
    expect(body.reference_forward).toMatchObject({
      model_only: false,
      weights: { crowd: BLEND_SCHEDULE.crowd.max_weight },
      components: { crowd: { n_forecasters: 10, kind: "forward", unit: forward.unit } },
    });
    expect(body.instruments.map((row: { question_slug: string }) => row.question_slug)).toEqual(
      expect.arrayContaining([binary.slug, forward.slug]),
    );

    expect((await verifyReplay(postgres.db)).passed).toBe(true);
    expect(await verifyDealer(postgres.db)).toMatchObject({ passed: true, findings: [] });
  });
});
