import { createHash } from "node:crypto";

import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runDealerJob } from "../../src/lib/services/dealer/run-dealer-job.js";
import { runSettleJob } from "../../src/lib/services/dealer/settle-instruments.js";
import { forwardQuestionUnit } from "../../src/lib/services/dealer/tournament-bridge.js";
import { verifyDealer } from "../../src/lib/services/dealer/verify-dealer.js";
import {
  closeQuestionIn,
  openQuestionIn,
  saveDraftQuestion,
  voidQuestion,
} from "../../src/lib/services/tournament/admin.js";
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
 * The tournament bridge (milestone 7, decision 0004): every instrument the
 * dealer lists has an open tournament question of its own kind, and the
 * settle job resolves or voids it in the settlement's own transaction. The
 * fixture's calendar: names listed on 2026-09-01, Instinct's Series C
 * release of 2026-09-28 ($10B post-money) the first announcement after
 * listing.
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

type Forecast = { readonly p: number } | { readonly value: number };

/**
 * The event hash decision 0004 pins: sha256(question ‖ user ‖ ISO time ‖
 * payload), the payload a binary's [p, 1 − p] at 10 dp or a forward's
 * "fwd:" + x at 10 dp. Written out here so the fixture events are exactly
 * what verify:replay re-derives.
 */
function forecastHash(questionId: string, userId: string, at: Date, forecast: Forecast): string {
  const payload =
    "p" in forecast
      ? [forecast.p, 1 - forecast.p].map((probability) => probability.toFixed(10)).join(",")
      : `fwd:${forecast.value.toFixed(10)}`;
  return createHash("sha256")
    .update(questionId)
    .update(userId)
    .update(at.toISOString())
    .update(payload)
    .digest("hex");
}

postgresDescribe(suiteName, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  beforeEach(async () => {
    vi.stubEnv("TOURNAMENT_LINKED_QUESTIONS", "1");
    await resetPostgresTestDatabase(postgres.db);
    await seedFixtureListings(postgres.db, LISTED_AT);
    await runDealerJob(postgres.db, "bridge-list", RUN_AT);
  });

  afterEach(() => vi.unstubAllEnvs());

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
        "questions.id as question_id",
        "questions.kind as question_kind",
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

  /** A forecast event at a fixture time, hashed as verify:replay re-derives it. */
  async function forecastAt(questionId: string, userId: string, at: Date, forecast: Forecast) {
    await postgres.db
      .insertInto("tournament_forecast_events")
      .values({
        user_id: userId,
        question_id: questionId,
        submitted_at: at,
        p: "p" in forecast ? String(forecast.p) : null,
        value: "value" in forecast ? String(forecast.value) : null,
        client_hash: null,
        event_hash: forecastHash(questionId, userId, at, forecast),
      })
      .execute();
  }

  it("lists instruments without questions while linked questions are off", async () => {
    vi.stubEnv("TOURNAMENT_LINKED_QUESTIONS", "");
    await resetPostgresTestDatabase(postgres.db);
    await seedFixtureListings(postgres.db, LISTED_AT);
    await runDealerJob(postgres.db, "bridge-off", RUN_AT);
    const instruments = await postgres.db.selectFrom("instruments").select("id").execute();
    expect(instruments.length).toBe(NAMES.length * 2);
    const questions = await postgres.db.selectFrom("tournament_questions").select("id").execute();
    expect(questions).toHaveLength(0);
    expect(
      await postgres.db.selectFrom("tournament_instrument_links").selectAll().execute(),
    ).toEqual([]);
  });

  it("lists every instrument with an open question of its own kind", async () => {
    const links = await postgres.db.selectFrom("tournament_instrument_links").selectAll().execute();
    expect(links).toHaveLength(NAMES.length * 2);

    const [binary, forward] = await linked("instinct");
    expect(binary).toMatchObject({
      kind: "binary",
      question_kind: "binary",
      slug: "instinct-round-by-2026-09-30",
      unit: null,
      status: "open",
      rulebook_version: 1,
    });
    expect(binary!.title).toBe(binary!.question);
    expect(binary!.opens_at).toEqual(RUN_AT);
    expect(binary!.closes_at).toEqual(binary!.expires_at);
    expect(binary!.rulebook_md).toContain("OpenMarket rulebook 1.0.0");

    // The forward's unit follows its listing mid; it carries no edges.
    const firstMid = await postgres.db
      .selectFrom("model_mids")
      .select("mid_ln")
      .where("instrument_id", "=", forward!.instrument_id)
      .orderBy("computed_at")
      .executeTakeFirstOrThrow();
    expect(forward).toMatchObject({
      kind: "forward",
      question_kind: "forward",
      slug: "instinct-next-print-by-2026-11-30",
      unit: forwardQuestionUnit(Math.exp(firstMid.mid_ln!)),
      status: "open",
    });
    expect(forward!.closes_at).toEqual(forward!.expires_at);
    expect(forward!.expiry_at).toEqual(forward!.expires_at);
    expect(forward!.rulebook_md).not.toMatch(/bucket|floor/i);

    // Every forward question is a forward in a dollar unit; every binary has none.
    const all = await postgres.db
      .selectFrom("tournament_instrument_links as links")
      .innerJoin("instruments", "instruments.id", "links.instrument_id")
      .innerJoin("tournament_questions as questions", "questions.id", "links.question_id")
      .select(["instruments.kind", "questions.kind as question_kind", "questions.unit"])
      .execute();
    for (const row of all) {
      expect(row.question_kind).toBe(row.kind);
      if (row.kind === "binary") expect(row.unit).toBeNull();
      else expect(["USD_B", "USD_T"]).toContain(row.unit);
    }

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
    await forecastAt(binary!.question_id, early.tournamentUserId, before, { p: 0.8 });
    // Public after the announcement: kept in the log, never counted.
    await forecastAt(binary!.question_id, late.tournamentUserId, after, { p: 0.99 });
    const twelveBillion = forward!.unit === "USD_T" ? 0.012 : 12;
    await forecastAt(forward!.question_id, early.tournamentUserId, before, {
      value: twelveBillion,
    });

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
      outcome: "yes",
      resolved_value: null,
      rung_fired: 1,
      resolver_user_id: null,
      settle_run_id: "settle-1",
      superseded_by: null,
    });
    expect(binaryResolution.source_url).toContain("businesswire.com");

    // The settled forward resolves its question to the post-money, in the question's unit.
    const forwardResolution = resolutions.find((row) => row.question_id === forward!.question_id)!;
    const tenBillion = doneForward!.unit === "USD_T" ? 0.01 : 10;
    expect(forwardResolution).toMatchObject({
      outcome: null,
      rung_fired: 1,
      settle_run_id: "settle-1",
    });
    expect(Number(forwardResolution.resolved_value)).toBe(tenBillion);

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
      question: { slug: binary!.slug, status: "resolved", outcome: "yes" },
    });
    expect(settled.find((row) => row.instrument_id === forward!.instrument_id)).toMatchObject({
      outcome: "settled",
      question: { slug: forward!.slug, status: "resolved", resolved_value: tenBillion },
    });

    // Successors list with their own open questions.
    expect(nextBinary).toMatchObject({
      epoch: 2,
      status: "open",
      slug: "instinct-round-by-2026-12-31",
    });
    expect(nextBinary!.opens_at).toEqual(SETTLE_AT);
    expect(nextForward).toMatchObject({ epoch: 2, status: "open", question_kind: "forward" });

    expect((await verifyReplay(postgres.db)).passed).toBe(true);
    expect(await verifyDealer(postgres.db)).toMatchObject({ passed: true, findings: [] });
  });

  it("flags a linked resolution that does not carry the settlement's value", async () => {
    const [, forward] = await linked("instinct");
    await insertFixtureFlags(
      postgres.db,
      "instinct",
      ["release"],
      (flag) => flag.published_at > "2026-09-01",
    );
    await runSettleJob(postgres.db, "settle-tamper", SETTLE_AT);
    expect(await verifyDealer(postgres.db)).toMatchObject({ passed: true, findings: [] });
    // The settlement's record now names an $11B print; the question still says $10B.
    await postgres.db
      .updateTable("instruments")
      .set({
        resolution_json: sql`jsonb_set(resolution_json, '{post_money_usd}', '11000000000'::jsonb)`,
      })
      .where("id", "=", forward!.instrument_id)
      .execute();
    const verification = await verifyDealer(postgres.db);
    expect(verification.passed).toBe(false);
    expect(verification.findings).toContainEqual(
      expect.objectContaining({
        check: "linked_question",
        detail: expect.stringContaining("does not carry the settlement's value"),
      }),
    );
  });

  it("resolves an expired binary No and voids a void forward's question unscored", async () => {
    const [, modalForward] = await linked("modal");
    const forecaster = await createTrader(postgres.db, "voided");
    await forecastAt(
      modalForward!.question_id,
      forecaster.tournamentUserId,
      new Date("2026-09-05T00:00:00Z"),
      { value: modalForward!.unit === "USD_T" ? 0.02 : 20 },
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
      outcome: "no",
      resolved_value: null,
      rung_fired: null,
      source_url: null,
      settle_run_id: "expiry-1",
    });
    expect(nextBinary).toMatchObject({ kind: "binary", epoch: 2, status: "open" });

    const voidAt = new Date(modalForward!.expires_at.getTime() + 86_400_000 + 3_600_000);
    const voidRun = await runSettleJob(postgres.db, "expiry-2", voidAt);
    const voided = (await linked("modal")).find(
      (row) => row.question_id === modalForward!.question_id,
    )!;
    expect(voided.status).toBe("voided");
    expect(voided.void_note_md).toContain("Unscored");
    expect(
      voidRun.status === "succeeded" &&
        voidRun.result.outcomes.find((row) => row.instrument_id === modalForward!.instrument_id),
    ).toMatchObject({ outcome: "void", question: { slug: modalForward!.slug, status: "voided" } });
    const resolutions = await postgres.db
      .selectFrom("tournament_resolutions")
      .select("id")
      .where("question_id", "=", modalForward!.question_id)
      .execute();
    expect(resolutions).toEqual([]);
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
    // The backfilled forward takes the same unit: both read the instrument's listing mid.
    expect(after.map((row) => [row.question_kind, row.unit])).toEqual(
      before.map((row) => [row.question_kind, row.unit]),
    );
  });

  it("back-dates a close past the scheduled close only when the caller asks", async () => {
    const opens = new Date("2026-09-01T00:00:00.000Z");
    await saveDraftQuestion(postgres.db, {
      slug: "late-document",
      title: "Late document",
      description_md: "Description.",
      rulebook_md: "Rulebook.",
      rulebook_version: 1,
      kind: "binary",
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
