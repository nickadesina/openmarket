import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DEALER_PARAMS } from "../../src/lib/config/dealer.js";
import { forwardQuestionLadder } from "../../src/lib/engine/dealer/question-ladder.js";
import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { runSettleJob } from "../../src/lib/services/dealer/settle-instruments.js";
import { verifyDealer } from "../../src/lib/services/dealer/verify-dealer.js";
import {
  closeQuestionIn,
  openQuestionIn,
  saveDraftQuestion,
  voidQuestion,
} from "../../src/lib/services/tournament/admin.js";
import { forecastEventHash } from "../../src/lib/services/tournament/submit-forecast.js";
import { verifyReplay } from "../../src/lib/services/verify-replay.js";
import { insertFixtureFlags, NAMES, seedFixtureListings } from "./dealer-fixture.js";
import {
  createPostgresTestDatabase,
  createTrader,
  type PostgresTestDatabase,
  resetPostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * The tournament bridge (milestone 7): every instrument the dealer lists has
 * an open tournament question, and the settle job resolves or voids it in the
 * settlement's own transaction. The fixture's calendar: names listed on
 * 2026-09-01, Instinct's Series C release of 2026-09-28 the first
 * announcement after listing.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Tournament bridge PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Tournament bridge PostgreSQL integration";

const LISTED_AT = new Date("2026-09-01T00:00:00.000Z");
const RUN_AT = new Date("2026-09-01T00:05:00.000Z");
const ANNOUNCED = new Date("2026-09-28T00:00:00.000Z");
const SETTLE_AT = new Date("2026-09-29T00:41:00.000Z");

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    await resetPostgresTestDatabase(postgres.db);
    await seedFixtureListings(postgres.db, LISTED_AT);
    await runDealerJob(postgres.db, "bridge-list", RUN_AT);
  });

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  async function linked(slug: string) {
    return postgres.db
      .selectFrom("tournament_instrument_links as links")
      .innerJoin("instruments", "instruments.id", "links.instrument_id")
      .innerJoin("listings", "listings.id", "instruments.listing_id")
      .innerJoin("companies", "companies.id", "listings.company_id")
      .innerJoin("tournament_questions as questions", "questions.id", "links.question_id")
      .select([
        "instruments.id as instrument_id",
        "instruments.kind",
        "instruments.epoch",
        "instruments.question",
        "instruments.expires_at",
        "listings.tier",
        "questions.id as question_id",
        "questions.slug",
        "questions.title",
        "questions.unit",
        "questions.status",
        "questions.opens_at",
        "questions.closes_at",
        "questions.expiry_at",
        "questions.closed_at",
        "questions.rulebook_md",
        "questions.rulebook_version",
        "questions.void_note_md",
      ])
      .where("companies.slug", "=", slug)
      .orderBy("instruments.kind")
      .orderBy("instruments.epoch")
      .execute();
  }

  async function bucketsOf(questionId: string) {
    return postgres.db
      .selectFrom("tournament_buckets")
      .selectAll()
      .where("question_id", "=", questionId)
      .orderBy("index")
      .execute();
  }

  /** A forecast event at a fixture time; the tournament's own hash, so replay re-derives it. */
  async function forecastAt(questionId: string, userId: string, at: Date, probs: number[]) {
    await postgres.db
      .insertInto("tournament_forecast_events")
      .values({
        user_id: userId,
        question_id: questionId,
        submitted_at: at,
        probs: probs.map((probability) => probability.toFixed(10)),
        client_hash: null,
        event_hash: forecastEventHash(questionId, userId, at, probs),
      })
      .execute();
  }

  it("lists every instrument with an open question that asks what it settles", async () => {
    const links = await postgres.db.selectFrom("tournament_instrument_links").selectAll().execute();
    expect(links).toHaveLength(NAMES.length * 2);

    const [binary, forward] = await linked("instinct");
    expect(binary).toMatchObject({
      kind: "binary",
      slug: "instinct-round-by-2026-09-30",
      unit: "bool",
      status: "open",
      rulebook_version: 1,
    });
    expect(binary!.title).toBe(binary!.question);
    expect(binary!.opens_at).toEqual(RUN_AT);
    expect(binary!.closes_at).toEqual(binary!.expires_at);
    expect(binary!.rulebook_md).toContain("OpenMarket rulebook 1.0.0");

    const firstMid = await postgres.db
      .selectFrom("model_mids")
      .select("mid_ln")
      .where("instrument_id", "=", forward!.instrument_id)
      .orderBy("computed_at")
      .executeTakeFirstOrThrow();
    const ladder = forwardQuestionLadder(firstMid.mid_ln!, DEALER_PARAMS.sigma_tier[forward!.tier]);
    expect(forward).toMatchObject({
      kind: "forward",
      slug: "instinct-next-print-by-2026-11-30",
      unit: ladder.unit,
      status: "open",
    });
    expect(forward!.closes_at).toEqual(forward!.expires_at);
    expect(forward!.expiry_at).toEqual(forward!.expires_at);
    const buckets = await bucketsOf(forward!.question_id);
    expect(buckets.filter((bucket) => bucket.kind === "range").length).toBe(
      ladder.edges.length + 1,
    );
    expect(buckets.slice(1, -1).map((bucket) => Number(bucket.lower))).toEqual(ladder.edges);
    expect(buckets.at(-1)).toMatchObject({
      kind: "floor",
      label: "No qualifying print by 2026-11-30",
    });

    // The labs' binary asks about a public S-1.
    const [openaiBinary] = await linked("openai");
    expect(openaiBinary!.slug).toBe("openai-s1-by-2026-09-30");
    expect(openaiBinary!.title).toContain("publicly file an S-1");

    // A rerun lists nothing and links nothing.
    const rerun = await runDealerJob(postgres.db, "bridge-list-2", new Date("2026-09-01T00:20Z"));
    expect(rerun.status === "succeeded" && rerun.result.steps.list).toMatchObject({
      listed: [],
      linked: [],
    });
  });

  it("resolves a name's questions in its settlement, back-dated to the announcement", async () => {
    const [binary, forward] = await linked("instinct");
    const early = await createTrader(postgres.db, "early");
    const late = await createTrader(postgres.db, "late");
    const before = new Date("2026-09-10T00:00:00.000Z");
    const after = new Date("2026-09-28T12:00:00.000Z");
    await forecastAt(binary!.question_id, early.tournamentUserId, before, [0.8, 0.2]);
    // Public after the announcement: kept in the log, never counted.
    await forecastAt(binary!.question_id, late.tournamentUserId, after, [0.99, 0.01]);
    const forwardBuckets = await bucketsOf(forward!.question_id);
    const uniform = forwardBuckets.map(() => 1 / forwardBuckets.length);
    await forecastAt(forward!.question_id, early.tournamentUserId, before, uniform);

    await insertFixtureFlags(
      postgres.db,
      "instinct",
      ["scoop", "release"],
      (flag) => flag.published_at > "2026-09-01",
    );
    const outcome = await runSettleJob(postgres.db, "settle-1", SETTLE_AT);
    expect(outcome.status).toBe("succeeded");

    const [doneBinary, nextBinary, doneForward, nextForward] = await linked("instinct");
    expect(doneBinary).toMatchObject({ status: "resolved", closed_at: ANNOUNCED });
    expect(doneForward).toMatchObject({ status: "resolved", closed_at: ANNOUNCED });
    const resolutions = await postgres.db
      .selectFrom("tournament_resolutions")
      .selectAll()
      .where("question_id", "in", [doneBinary!.question_id, doneForward!.question_id])
      .execute();
    const binaryResolution = resolutions.find((row) => row.question_id === binary!.question_id)!;
    expect(binaryResolution).toMatchObject({
      winning_bucket_index: 0,
      resolved_value: null,
      rung_fired: 1,
      resolver_user_id: null,
      settle_run_id: "settle-1",
      superseded_by: null,
    });
    expect(binaryResolution.source_url).toContain("businesswire.com");
    const forwardResolution = resolutions.find((row) => row.question_id === forward!.question_id)!;
    const winning = forwardBuckets[forwardResolution.winning_bucket_index]!;
    const tenBillion = doneForward!.unit === "USD_T" ? 0.01 : 10;
    expect(Number(forwardResolution.resolved_value)).toBe(tenBillion);
    expect(winning.kind).toBe("range");
    expect(winning.lower === null || Number(winning.lower) <= tenBillion).toBe(true);
    expect(winning.upper === null || tenBillion < Number(winning.upper)).toBe(true);
    expect(forwardResolution).toMatchObject({ rung_fired: 1, settle_run_id: "settle-1" });

    // The early forecaster is scored; the post-announcement one is not.
    const scores = await postgres.db
      .selectFrom("tournament_scores")
      .select(["user_id", "question_id"])
      .where("question_id", "in", [binary!.question_id, forward!.question_id])
      .execute();
    expect(scores).toHaveLength(2);
    expect(scores.every((score) => score.user_id === early.tournamentUserId)).toBe(true);

    const settled = outcome.status === "succeeded" ? outcome.result.outcomes : [];
    expect(settled.find((row) => row.instrument_id === binary!.instrument_id)).toMatchObject({
      outcome: "yes",
      question: { slug: binary!.slug, status: "resolved", winning_bucket_index: 0 },
    });

    // Successors list with their own open questions.
    expect(nextBinary).toMatchObject({
      epoch: 2,
      status: "open",
      slug: "instinct-round-by-2026-12-31",
    });
    expect(nextBinary!.opens_at).toEqual(SETTLE_AT);
    expect(nextForward).toMatchObject({ epoch: 2, status: "open" });

    expect((await verifyReplay(postgres.db)).passed).toBe(true);
    expect(await verifyDealer(postgres.db)).toMatchObject({ passed: true, findings: [] });
  });

  it("resolves an expired binary No and voids a void forward's question unscored", async () => {
    const [, modalForward] = await linked("modal");
    const forecaster = await createTrader(postgres.db, "voided");
    const buckets = await bucketsOf(modalForward!.question_id);
    await forecastAt(
      modalForward!.question_id,
      forecaster.tournamentUserId,
      new Date("2026-09-05T00:00:00Z"),
      buckets.map(() => 1 / buckets.length),
    );

    await runSettleJob(postgres.db, "expiry-1", new Date("2026-10-02T00:41:00Z"));
    const [modalBinary, nextBinary] = await linked("modal");
    expect(modalBinary).toMatchObject({ status: "resolved", closed_at: null });
    const no = await postgres.db
      .selectFrom("tournament_resolutions")
      .selectAll()
      .where("question_id", "=", modalBinary!.question_id)
      .executeTakeFirstOrThrow();
    expect(no).toMatchObject({
      winning_bucket_index: 1,
      rung_fired: null,
      source_url: null,
      settle_run_id: "expiry-1",
    });
    expect(nextBinary).toMatchObject({ kind: "binary", epoch: 2, status: "open" });

    const voidAt = new Date(modalForward!.expires_at.getTime() + 86_400_000 + 3_600_000);
    await runSettleJob(postgres.db, "expiry-2", voidAt);
    const voided = (await linked("modal")).find(
      (row) => row.question_id === modalForward!.question_id,
    )!;
    expect(voided.status).toBe("voided");
    expect(voided.void_note_md).toContain("Unscored");
    const written = await postgres.db
      .selectFrom("tournament_scores")
      .select("user_id")
      .where("question_id", "=", modalForward!.question_id)
      .execute();
    expect(written).toEqual([]);
    const forwardSuccessor = (await linked("modal"))
      .filter((row) => row.kind === "forward")
      .at(-1)!;
    expect(forwardSuccessor).toMatchObject({ epoch: 2, status: "open" });

    expect((await verifyReplay(postgres.db)).passed).toBe(true);
  });

  it("leaves a question an admin voided as it stands and still settles the instrument", async () => {
    const [binary] = await linked("instinct");
    await voidQuestion(postgres.db, binary!.slug, { note_md: "Voided by an admin." });
    await insertFixtureFlags(
      postgres.db,
      "instinct",
      ["release"],
      (flag) => flag.published_at > "2026-09-01",
    );
    const outcome = await runSettleJob(postgres.db, "settle-voided", SETTLE_AT);
    const row =
      outcome.status === "succeeded"
        ? outcome.result.outcomes.find((entry) => entry.instrument_id === binary!.instrument_id)
        : undefined;
    expect(row).toMatchObject({
      outcome: "yes",
      question: { slug: binary!.slug, status: "skipped" },
    });
  });

  it("links a live instrument listed before the bridge on the next dealer run", async () => {
    const before = await linked("anthropic");
    await postgres.db
      .deleteFrom("tournament_instrument_links")
      .where(
        "instrument_id",
        "in",
        before.map((row) => row.instrument_id),
      )
      .execute();
    const run = await runDealerJob(postgres.db, "bridge-backfill", new Date("2026-09-02T00:05Z"));
    expect(run.status === "succeeded" && run.result.steps.list.linked).toEqual(
      before.map((row) => `${row.slug}-2`),
    );
    const after = await linked("anthropic");
    expect(after.map((row) => row.status)).toEqual(["open", "open"]);
  });

  it("back-dates a close past the scheduled close only when the caller asks", async () => {
    const opens = new Date("2026-09-01T00:00:00.000Z");
    await saveDraftQuestion(postgres.db, {
      slug: "late-document",
      title: "Late document",
      description_md: "Description.",
      rulebook_md: "Rulebook.",
      rulebook_version: 1,
      unit: "bool",
      opens_at: opens.toISOString(),
      closes_at: "2026-09-30T00:00:00.000Z",
    });
    await postgres.db.transaction().execute((tx) => openQuestionIn(tx, "late-document", opens));
    const at = new Date("2026-09-30T06:00:00.000Z");
    const documentAt = "2026-09-29T12:00:00.000Z";
    const close = (closedAt: string, afterScheduledClose: boolean) =>
      postgres.db
        .transaction()
        .execute((tx) =>
          closeQuestionIn(
            tx,
            "late-document",
            { closed_at: closedAt },
            { at, afterScheduledClose },
          ),
        );
    await expect(close(documentAt, false)).rejects.toThrow(/Only an open question/);
    await expect(close("2026-09-30T03:00:00.000Z", true)).rejects.toThrow(/scheduled close/);
    expect(await close(documentAt, true)).toEqual({
      slug: "late-document",
      closedAt: documentAt,
    });
  });
});
