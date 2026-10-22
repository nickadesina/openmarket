import { createHash } from "node:crypto";

import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LAUNCH_QUESTIONS } from "../../src/lib/config/tournament-questions.js";
import type { Database } from "../../src/lib/db/schema.js";
import { buildMerkleTree, merkleRootFromPath } from "../../src/lib/services/tournament/merkle.js";
import {
  createPostgresTestDatabase,
  migrateTestDatabase,
  type PostgresTestDatabase,
  TEST_DATABASE_SKIP_REASON,
  testDatabaseUrl,
} from "./postgres.js";

/**
 * Migration 013_tournament_contract_models (decision 0004): run against a
 * populated 012 tournament, then down and up on an empty one. Fixtures are
 * raw SQL in the 012 shape; the services already speak the 013 one.
 */
const databaseUrl = testDatabaseUrl();
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;
const suiteName =
  databaseUrl === undefined
    ? `Tournament migration 013 PostgreSQL integration (${TEST_DATABASE_SKIP_REASON})`
    : "Tournament migration 013 PostgreSQL integration";

const BEFORE_013 = "012_tournament_choice";
const MIGRATION_013 = "013_tournament_contract_models";
const OPENS_AT = "2026-10-01T00:00:00.000Z";
const CLOSES_AT = "2026-12-31T23:59:59.000Z";

type Db = Kysely<Database>;

interface LegacyQuestion {
  readonly slug: string;
  readonly unit: "USD_B" | "USD_T" | "bool" | "choice";
  readonly buckets: readonly {
    readonly kind: "range" | "floor";
    readonly lower: string | null;
    readonly upper: string | null;
    readonly label: string;
  }[];
}

const LEGACY_QUESTIONS: readonly LegacyQuestion[] = [
  {
    slug: "anthropic-ipo-day1-mcap",
    unit: "USD_T",
    buckets: [
      { kind: "range", lower: null, upper: "0.5", label: "Under $0.5T" },
      { kind: "range", lower: "0.5", upper: "1", label: "$0.5T–$1T" },
      { kind: "range", lower: "1", upper: null, label: "Over $1T" },
      { kind: "floor", lower: null, upper: null, label: "No first trade by expiry" },
    ],
  },
  {
    slug: "anthropic-424b-run-rate",
    unit: "USD_B",
    buckets: [
      { kind: "range", lower: null, upper: "20", label: "Under $20B" },
      { kind: "range", lower: "20", upper: null, label: "$20B or more" },
      { kind: "floor", lower: null, upper: null, label: "No such KPI" },
    ],
  },
  {
    // Production's slug; 0004 opens its replacement as openai-round-before-anthropic-ipo.
    slug: "openai-round-vs-anthropic-ipo",
    unit: "choice",
    buckets: [
      { kind: "range", lower: null, upper: null, label: "OpenAI round first" },
      { kind: "range", lower: null, upper: null, label: "Anthropic trades first" },
      { kind: "floor", lower: null, upper: null, label: "Neither by expiry" },
    ],
  },
];

/** The 012 provenance hash: sha256(question ‖ user ‖ ISO time ‖ canonical vector). */
function legacyEventHash(
  questionId: string,
  userId: string,
  submittedAt: string,
  probs: readonly string[],
): string {
  const canonical = probs.map((probability) => Number(probability).toFixed(10)).join(",");
  return createHash("sha256")
    .update(questionId)
    .update(userId)
    .update(submittedAt)
    .update(canonical)
    .digest("hex");
}

/** `{0.1,0.9}` → ["0.1", "0.9"]: a one-dimensional numeric[] in its text form. */
function parseNumericArray(text: string): string[] {
  return text.slice(1, -1).split(",");
}

async function columns(postgres: PostgresTestDatabase, table: string): Promise<string[]> {
  const { rows } = await sql<{ column_name: string }>`
    select column_name from information_schema.columns
    where table_schema = ${postgres.schema} and table_name = ${table}
    order by column_name
  `.execute(postgres.db);
  return rows.map((row) => row.column_name);
}

async function relationExists(postgres: PostgresTestDatabase, name: string): Promise<boolean> {
  const { rows } = await sql<{ exists: boolean }>`
    select to_regclass(${`${postgres.schema}.${name}`}) is not null as exists
  `.execute(postgres.db);
  return rows[0]!.exists;
}

async function insertUser(db: Db): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into tournament_users default values returning id
  `.execute(db);
  return rows[0]!.id;
}

/** A 012 question with its buckets; `status` open unless given. */
async function insertLegacyQuestion(
  db: Db,
  question: LegacyQuestion,
  status: "open" | "voided" = "open",
): Promise<string> {
  const voidNote = status === "voided" ? "Voided before 013." : null;
  const { rows } = await sql<{ id: string }>`
    insert into tournament_questions (
      slug, title, description_md, rulebook_md, rulebook_version, unit, bucket_count,
      opens_at, closes_at, expiry_at, status, void_note_md
    ) values (
      ${question.slug}, ${`Question ${question.slug}`}, 'Description.', 'Rulebook.', 1,
      ${question.unit}, ${question.buckets.length}, ${OPENS_AT}, ${CLOSES_AT}, ${CLOSES_AT},
      ${status}, ${voidNote}
    )
    returning id
  `.execute(db);
  const id = rows[0]!.id;
  for (const [index, bucket] of question.buckets.entries()) {
    await sql`
      insert into tournament_buckets (question_id, index, kind, lower, upper, label)
      values (${id}, ${index}, ${bucket.kind}, ${bucket.lower}, ${bucket.upper}, ${bucket.label})
    `.execute(db);
  }
  return id;
}

/** A 012 vector event, hashed the way 012's submit did. */
async function insertLegacyEvent(
  db: Db,
  input: {
    readonly questionId: string;
    readonly userId: string;
    readonly submittedAt: string;
    readonly probs: readonly string[];
  },
): Promise<{ readonly id: string; readonly eventHash: string }> {
  const eventHash = legacyEventHash(input.questionId, input.userId, input.submittedAt, input.probs);
  const { rows } = await sql<{ id: string }>`
    insert into tournament_forecast_events (user_id, question_id, submitted_at, probs, event_hash)
    values (
      ${input.userId}, ${input.questionId}, ${input.submittedAt},
      ${`{${input.probs.join(",")}}`}::numeric[], ${eventHash}
    )
    returning id
  `.execute(db);
  return { id: rows[0]!.id, eventHash };
}

/** One posted provenance batch committing to `events` in order. */
async function insertPostedBatch(
  db: Db,
  hourStart: string,
  events: readonly { readonly id: string; readonly eventHash: string }[],
): Promise<void> {
  const tree = buildMerkleTree(events.map((event) => event.eventHash));
  const { rows } = await sql<{ id: string }>`
    insert into tournament_provenance_batches
      (hour_start, root, leaf_count, memo, tx_signature, posted_at, confirmed_at)
    values (
      ${hourStart}, ${tree.root}, ${events.length}, ${`openmarket:${tree.root}`},
      ${`signature-${hourStart}`}, ${hourStart}::timestamptz + interval '1 hour',
      ${hourStart}::timestamptz + interval '1 hour'
    )
    returning id
  `.execute(db);
  for (const [index, event] of events.entries()) {
    await sql`
      insert into tournament_provenance_leaves (event_id, batch_id, leaf_index, path)
      values (${event.id}, ${rows[0]!.id}, ${index}, ${tree.paths[index]!}::text[])
    `.execute(db);
  }
}

/** A listed company, for a reference price to point at. */
async function insertListing(db: Db): Promise<string> {
  const { rows: companies } = await sql<{ id: string }>`
    insert into companies (name, slug, logo_path)
    values ('Migration Co', 'migration-co', '/test.svg')
    returning id
  `.execute(db);
  const { rows } = await sql<{ id: string }>`
    insert into listings (
      company_id, tier, binary_event, kappa, cap_cents, b_cents, spread_floor, gamma, p_floor,
      forward_t_days, model_version, anchor_round, anchor_date, anchor_post_money_usd,
      anchor_source_url, anchor_source_rank, listed_at
    ) values (
      ${companies[0]!.id}, 'mega', 'priced_round', 1, 2500000, 200000, 0.05, 0.5, 0.05,
      90, '1.0.0', 'Series A', '2026-09-28', 10000000000, 'https://example.test/migration-co',
      1, ${OPENS_AT}
    )
    returning id
  `.execute(db);
  return rows[0]!.id;
}

async function insertReferencePrice(db: Db, listingId: string, crowd: unknown): Promise<void> {
  const components = { instrument_id: "fixture", kind: "binary", crowd };
  await sql`
    insert into reference_prices (
      listing_id, kind, as_of, value, blend_version, model_version, rulebook_version,
      w_model, w_traded, w_crowd, components_json
    ) values (
      ${listingId}, 'binary', ${OPENS_AT}, 0.4, 'blend-1', '1.0.0', 'rulebook-1',
      1, 0, 0, ${JSON.stringify(components)}::jsonb
    )
  `.execute(db);
}

postgresDescribe(`${suiteName}: on a populated 012 tournament`, () => {
  let postgres: PostgresTestDatabase;
  const questionIds = new Map<string, string>();
  let voidedQuestionId: string;
  let userIds: string[];
  /** Each event's vector as 012 stored it, `numeric[]::text`. */
  let vectorsBefore: { id: string; probs: string }[];

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!, BEFORE_013);
    const db = postgres.db;

    userIds = [await insertUser(db), await insertUser(db)];
    for (const question of LEGACY_QUESTIONS) {
      questionIds.set(question.slug, await insertLegacyQuestion(db, question));
    }
    voidedQuestionId = await insertLegacyQuestion(
      db,
      {
        slug: "voided-before-013",
        unit: "bool",
        buckets: [
          { kind: "range", lower: null, upper: null, label: "No" },
          { kind: "range", lower: null, upper: null, label: "Yes" },
        ],
      },
      "voided",
    );

    const [alice, bob] = userIds as [string, string];
    const ipo = questionIds.get("anthropic-ipo-day1-mcap")!;
    const runRate = questionIds.get("anthropic-424b-run-rate")!;
    const race = questionIds.get("openai-round-vs-anthropic-ipo")!;
    const firstHour = [
      await insertLegacyEvent(db, {
        questionId: ipo,
        userId: alice,
        submittedAt: "2026-10-22T16:05:00.125Z",
        probs: ["0.1000000000", "0.3500000000", "0.4500000000", "0.1000000000"],
      }),
      await insertLegacyEvent(db, {
        questionId: race,
        userId: alice,
        submittedAt: "2026-10-22T16:20:00.000Z",
        probs: ["0.3333333333", "0.3333333334", "0.3333333333"],
      }),
      await insertLegacyEvent(db, {
        questionId: runRate,
        userId: bob,
        submittedAt: "2026-10-22T16:45:30.999Z",
        probs: ["0.6000000000", "0.3000000000", "0.1000000000"],
      }),
    ];
    const secondHour = [
      await insertLegacyEvent(db, {
        questionId: ipo,
        userId: alice,
        submittedAt: "2026-10-22T17:01:00.001Z",
        probs: ["0.0500000000", "0.2500000000", "0.6000000000", "0.1000000000"],
      }),
      await insertLegacyEvent(db, {
        questionId: race,
        userId: bob,
        submittedAt: "2026-10-22T17:30:00.000Z",
        probs: ["0.7000000000", "0.2000000000", "0.1000000000"],
      }),
    ];
    await insertPostedBatch(db, "2026-10-22T16:00:00.000Z", firstHour);
    await insertPostedBatch(db, "2026-10-22T17:00:00.000Z", secondHour);

    await sql`
      insert into tournament_aggregates
        (question_id, computed_at, probs, n_forecasters, extremization, weighting_version)
      values
        (${race}, '2026-10-22T17:30:00.000Z', '{0.5,0.3,0.2}'::numeric[], 2, 1.5, 'v1')
    `.execute(db);
    // A reference price with no crowd component does not stop 013.
    await insertReferencePrice(db, await insertListing(db), null);

    const { rows } = await sql<{ id: string; probs: string }>`
      select id, probs::text as probs from tournament_forecast_events order by id
    `.execute(db);
    vectorsBefore = rows;
    expect(vectorsBefore).toHaveLength(5);

    const migration = await migrateTestDatabase(postgres, "latest");
    expect(migration.error).toBeUndefined();
    expect(migration.results?.map((result) => result.migrationName)).toEqual([MIGRATION_013]);
  }, 30_000);

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  it("voids and renames every open question with a note naming its replacement", async () => {
    const questions = await postgres.db
      .selectFrom("tournament_questions")
      .select(["id", "slug", "kind", "unit", "status", "void_note_md"])
      .orderBy("slug")
      .execute();
    expect(questions).toEqual(
      [
        {
          id: questionIds.get("anthropic-424b-run-rate"),
          slug: "anthropic-424b-run-rate-v1",
          kind: "forward",
          unit: "USD_B",
          status: "voided",
          void_note_md:
            "Replaced by the forward question at /t/q/anthropic-424b-run-rate; bucket forecasts are not scored.",
        },
        {
          id: questionIds.get("anthropic-ipo-day1-mcap"),
          slug: "anthropic-ipo-day1-mcap-v1",
          kind: "forward",
          unit: "USD_T",
          status: "voided",
          void_note_md:
            "Replaced by the forward question at /t/q/anthropic-ipo-day1-mcap; bucket forecasts are not scored.",
        },
        {
          id: questionIds.get("openai-round-vs-anthropic-ipo"),
          slug: "openai-round-vs-anthropic-ipo-v1",
          kind: "binary",
          unit: null,
          status: "voided",
          void_note_md:
            "Replaced by the binary question at /t/q/openai-round-before-anthropic-ipo; bucket forecasts are not scored.",
        },
        {
          id: voidedQuestionId,
          slug: "voided-before-013",
          kind: "binary",
          unit: null,
          status: "voided",
          void_note_md: "Voided before 013.",
        },
      ].sort((left, right) => left.slug.localeCompare(right.slug)),
    );
    expect(await columns(postgres, "tournament_questions")).not.toContain("bucket_count");
    expect(await relationExists(postgres, "tournament_buckets")).toBe(false);
  });

  it("links each voided production question to a replacement the seed opens, of its kind", async () => {
    const launched = new Map(LAUNCH_QUESTIONS.map((question) => [question.slug, question.kind]));
    const voided = await postgres.db
      .selectFrom("tournament_questions")
      .select(["slug", "kind", "void_note_md"])
      .where("slug", "like", "%-v1")
      .execute();
    expect(voided).toHaveLength(LEGACY_QUESTIONS.length);
    for (const question of voided) {
      const target = /\/t\/q\/([a-z0-9-]+);/.exec(question.void_note_md ?? "")?.[1];
      expect(target, question.slug).toBeDefined();
      expect(launched.get(target!), `${question.slug} → ${target}`).toBe(question.kind);
    }
  });

  it("archives every vector byte for byte and changes no event row", async () => {
    const { rows: archived } = await sql<{ id: string; probs: string }>`
      select event_id as id, probs::text as probs
      from tournament_archived_forecast_vectors order by event_id
    `.execute(postgres.db);
    expect(archived).toEqual(vectorsBefore);

    const events = await postgres.db
      .selectFrom("tournament_forecast_events")
      .select(["id", "p", "value"])
      .orderBy("id")
      .execute();
    expect(events).toEqual(vectorsBefore.map(({ id }) => ({ id, p: null, value: null })));
    expect(await columns(postgres, "tournament_forecast_events")).not.toContain("probs");
  });

  it("recomputes each legacy event hash from its archived vector", async () => {
    const { rows } = await sql<{
      question_id: string;
      user_id: string;
      submitted_at: Date;
      event_hash: string;
      probs: string;
    }>`
      select events.question_id, events.user_id, events.submitted_at, events.event_hash,
        archive.probs::text as probs
      from tournament_forecast_events events
      join tournament_archived_forecast_vectors archive on archive.event_id = events.id
    `.execute(postgres.db);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(
        legacyEventHash(
          row.question_id,
          row.user_id,
          row.submitted_at.toISOString(),
          parseNumericArray(row.probs),
        ),
      ).toBe(row.event_hash);
    }
  });

  it("keeps every posted batch root recomputable from its leaves", async () => {
    const batches = await postgres.db
      .selectFrom("tournament_provenance_batches")
      .select(["id", "root", "leaf_count"])
      .execute();
    expect(batches).toHaveLength(2);
    for (const batch of batches) {
      const leaves = await postgres.db
        .selectFrom("tournament_provenance_leaves as leaves")
        .innerJoin("tournament_forecast_events as events", "events.id", "leaves.event_id")
        .select(["events.event_hash", "leaves.path"])
        .where("leaves.batch_id", "=", batch.id)
        .orderBy("leaves.leaf_index")
        .execute();
      expect(leaves).toHaveLength(batch.leaf_count);
      expect(buildMerkleTree(leaves.map((leaf) => leaf.event_hash)).root).toBe(batch.root);
      for (const leaf of leaves) {
        expect(merkleRootFromPath(leaf.event_hash, leaf.path)).toBe(batch.root);
      }
    }
  });

  it("takes exactly one of p and value on a new event", async () => {
    const alice = userIds[0]!;
    const questionId = questionIds.get("openai-round-vs-anthropic-ipo")!;
    const insert = (p: string | null, value: string | null) =>
      sql`
        insert into tournament_forecast_events
          (user_id, question_id, submitted_at, p, value, event_hash)
        values (${alice}, ${questionId}, now(), ${p}, ${value}, ${"a".repeat(64)})
      `.execute(postgres.db);

    await expect(insert(null, null)).rejects.toThrow(/tournament_forecast_events_one_payload/);
    await expect(insert("0.4", "412")).rejects.toThrow(/tournament_forecast_events_one_payload/);
    await expect(insert("1", null)).rejects.toThrow(/tournament_forecast_events_p/);
    await expect(insert(null, "0")).rejects.toThrow(/tournament_forecast_events_value/);
    await expect(insert("0.4", null)).resolves.toBeDefined();
    await expect(insert(null, "412")).resolves.toBeDefined();
  });

  it("keeps the archive append-only", async () => {
    const event = vectorsBefore[0]!;
    await expect(
      sql`
        update tournament_archived_forecast_vectors set probs = '{1}' where event_id = ${event.id}
      `.execute(postgres.db),
    ).rejects.toThrow(/append-only/);
    await expect(
      sql`
        delete from tournament_archived_forecast_vectors where event_id = ${event.id}
      `.execute(postgres.db),
    ).rejects.toThrow(/append-only/);
  });

  it("clears the derived aggregates and takes one p or value from then on", async () => {
    expect(await postgres.db.selectFrom("tournament_aggregates").select("id").execute()).toEqual(
      [],
    );
    expect(await columns(postgres, "tournament_aggregates")).toEqual([
      "computed_at",
      "extremization",
      "id",
      "n_forecasters",
      "p",
      "question_id",
      "value",
      "weighting_version",
    ]);
    const questionId = questionIds.get("anthropic-ipo-day1-mcap")!;
    const insert = (n: number, p: string | null, value: string | null) =>
      sql`
        insert into tournament_aggregates
          (question_id, computed_at, n_forecasters, p, value, extremization, weighting_version)
        values (${questionId}, now(), ${n}, ${p}, ${value}, 1.5, 'v2')
      `.execute(postgres.db);
    await expect(insert(0, "0.5", null)).rejects.toThrow(/tournament_aggregates_payload/);
    await expect(insert(2, null, null)).rejects.toThrow(/tournament_aggregates_payload/);
    await expect(insert(2, "0.5", "1.2")).rejects.toThrow(/tournament_aggregates_payload/);
    await expect(insert(0, null, null)).resolves.toBeDefined();
    await expect(insert(2, null, "1.2")).resolves.toBeDefined();
  });

  it("refuses to go down while questions exist", async () => {
    const down = await migrateTestDatabase(postgres, BEFORE_013);
    expect(String(down.error)).toMatch(/013 down runs only without tournament questions/);
    expect(await columns(postgres, "tournament_questions")).toContain("kind");
    expect(await relationExists(postgres, "tournament_archived_forecast_vectors")).toBe(true);
  });
});

postgresDescribe(`${suiteName}: pre-checks`, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!, BEFORE_013);
  }, 30_000);

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  async function expectRefused(pattern: RegExp): Promise<void> {
    const migration = await migrateTestDatabase(postgres, "latest");
    expect(String(migration.error)).toMatch(pattern);
    expect(await relationExists(postgres, "tournament_buckets")).toBe(true);
    expect(await columns(postgres, "tournament_questions")).not.toContain("kind");
    const { rows } = await sql<{ status: string }>`
      select status from tournament_questions
    `.execute(postgres.db);
    expect(rows).toEqual([{ status: "open" }]);
  }

  it("refuses, changing nothing, once the blend cites a crowd aggregate or a question resolved", async () => {
    const db = postgres.db;
    const [question] = LEGACY_QUESTIONS as [LegacyQuestion];
    const questionId = await insertLegacyQuestion(db, question);
    const resolver = await insertUser(db);
    const { rows: aggregates } = await sql<{ id: string }>`
      insert into tournament_aggregates
        (question_id, computed_at, probs, n_forecasters, extremization, weighting_version)
      values (${questionId}, now(), '{0.25,0.25,0.25,0.25}'::numeric[], 5, 1.5, 'v1')
      returning id
    `.execute(db);
    await insertReferencePrice(db, await insertListing(db), {
      question_id: questionId,
      aggregate_id: aggregates[0]!.id,
    });
    await expectRefused(/a reference price cites a tournament aggregate/);

    await sql`
      insert into tournament_resolutions
        (question_id, resolved_at, winning_bucket_index, note_md, resolver_user_id)
      values (${questionId}, now(), 1, 'Resolved.', ${resolver})
    `.execute(db);
    await expectRefused(/tournament_resolutions has rows/);
  });
});

postgresDescribe(`${suiteName}: on an empty tournament`, () => {
  let postgres: PostgresTestDatabase;

  beforeAll(async () => {
    postgres = await createPostgresTestDatabase(databaseUrl!);
  }, 30_000);

  afterAll(async () => {
    if (postgres !== undefined) await postgres.dispose();
  });

  it("goes down to the 012 shape and back up", async () => {
    const down = await migrateTestDatabase(postgres, BEFORE_013);
    expect(down.error).toBeUndefined();
    expect(down.results?.map((result) => [result.migrationName, result.direction])).toEqual([
      [MIGRATION_013, "Down"],
    ]);
    expect(await relationExists(postgres, "tournament_buckets")).toBe(true);
    expect(await relationExists(postgres, "tournament_buckets_one_floor")).toBe(true);
    expect(await relationExists(postgres, "tournament_archived_forecast_vectors")).toBe(false);
    expect(await columns(postgres, "tournament_questions")).toContain("bucket_count");
    expect(await columns(postgres, "tournament_questions")).not.toContain("kind");
    expect(await columns(postgres, "tournament_forecast_events")).toContain("probs");
    expect(await columns(postgres, "tournament_aggregates")).toEqual(
      expect.arrayContaining(["probs", "median_value", "p_floor", "p_yes"]),
    );
    expect(await columns(postgres, "tournament_resolutions")).toContain("winning_bucket_index");
    // The 012 shape takes a 012 question again.
    const [question] = LEGACY_QUESTIONS as [LegacyQuestion];
    await insertLegacyQuestion(postgres.db, question);
    await sql`delete from tournament_buckets`.execute(postgres.db);
    await sql`delete from tournament_questions`.execute(postgres.db);

    const up = await migrateTestDatabase(postgres, "latest");
    expect(up.error).toBeUndefined();
    expect(up.results?.map((result) => [result.migrationName, result.direction])).toEqual([
      [MIGRATION_013, "Up"],
    ]);
  });

  it("holds a question's kind to its unit and a resolution to one result", async () => {
    const db = postgres.db;
    const insertQuestion = (slug: string, kind: string, unit: string | null) =>
      sql<{ id: string }>`
        insert into tournament_questions (
          slug, title, description_md, rulebook_md, rulebook_version, kind, unit,
          opens_at, closes_at, expiry_at, status
        ) values (
          ${slug}, 'Title', 'Description.', 'Rulebook.', 1, ${kind}, ${unit},
          ${OPENS_AT}, ${CLOSES_AT}, ${CLOSES_AT}, 'open'
        )
        returning id
      `.execute(db);
    await expect(insertQuestion("a", "binary", "USD_B")).rejects.toThrow(
      /tournament_questions_kind_unit/,
    );
    await expect(insertQuestion("b", "forward", null)).rejects.toThrow(
      /tournament_questions_kind_unit/,
    );
    await expect(insertQuestion("c", "forward", "bool")).rejects.toThrow(
      /tournament_questions_unit/,
    );
    await expect(insertQuestion("d", "choice", null)).rejects.toThrow(/tournament_questions_kind/);
    const { rows } = await insertQuestion("binary", "binary", null);
    await expect(insertQuestion("forward", "forward", "USD_T")).resolves.toBeDefined();

    const resolver = await insertUser(db);
    const resolve = (outcome: string | null, resolvedValue: string | null) =>
      sql`
        insert into tournament_resolutions
          (question_id, resolved_at, outcome, resolved_value, note_md, resolver_user_id)
        values (${rows[0]!.id}, now(), ${outcome}, ${resolvedValue}, 'Resolved.', ${resolver})
      `.execute(db);
    await expect(resolve(null, null)).rejects.toThrow(/tournament_resolutions_one_result/);
    await expect(resolve("yes", "1")).rejects.toThrow(/tournament_resolutions_one_result/);
    await expect(resolve("maybe", null)).rejects.toThrow(/tournament_resolutions_outcome/);
    await expect(resolve("yes", null)).resolves.toBeDefined();
  });
});
