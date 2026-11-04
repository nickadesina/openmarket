import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  type BinaryEvent,
  type BinaryResolution,
  binaryExpiry,
  EVENT_TYPES,
  type EventType,
  type ForwardResolution,
  isPrint,
  RULEBOOK,
  RULEBOOK_VERSION,
  type RulebookEvent,
  resolveBinary,
  resolveForward,
  resolvesBinary,
} from "../../src/lib/engine/rulebook.js";
import { parseCsv } from "../../src/lib/tradeables/csv.js";
import {
  DATA_THROUGH as DATA_THROUGH_DATE,
  EVENTS_CSV_PATH,
} from "../../src/lib/tradeables/round-history.js";

/**
 * data/round-history/events.csv is the fixture every rulebook change must
 * still resolve (README D13). The resolutions are recorded in
 * tests/fixtures/rulebook-events.json; a rule change that moves any of them
 * re-baselines that file (`vitest -u`) in the same commit, so the diff is the
 * review.
 *
 * events.csv records announced closes and carries no source rank, so every
 * row enters as rank 1. The labs are the names whose binary is a public S-1.
 */
const LABS = new Set(["OpenAI", "Anthropic"]);
const DATA_THROUGH = new Date(`${DATA_THROUGH_DATE}T23:59:59Z`);
/**
 * The contract terms v1 listed the five names under, inlined from its
 * backtest/out/params.json (tag archive/dealer-v1) when the backtest was
 * archived: the binary's expiry floor and each name's forward T.
 */
const BINARY_MIN_DAYS = 21;
const FORWARD_T_DAYS: Readonly<Record<string, number>> = {
  Anduril: 270,
  Anthropic: 180,
  Instinct: 90,
  Modal: 120,
  OpenAI: 270,
};
const BINARY_START = new Date("2024-01-01T00:00:00Z");
const DAY_MS = 86_400_000;

interface EventRow {
  readonly company: string;
  readonly event_type: string;
  readonly round_name: string;
  readonly announcement_date: string;
  readonly post_money_usd: string;
}

const rows = parseCsv(readFileSync(EVENTS_CSV_PATH, "utf8")) as unknown as EventRow[];

function eventType(row: EventRow): EventType {
  const type = row.event_type as EventType;
  if (!EVENT_TYPES.includes(type)) throw new Error(`unknown event_type ${row.event_type}`);
  return type;
}

function binaryEventOf(company: string): BinaryEvent {
  return LABS.has(company) ? "public_s1" : "priced_round";
}

function toEvent(row: EventRow): RulebookEvent {
  return {
    id: `${row.company} · ${row.round_name}`,
    eventType: eventType(row),
    announcedAt: new Date(`${row.announcement_date}T00:00:00Z`),
    rank: 1,
    postMoneyUsd: row.post_money_usd === "" ? null : Number(row.post_money_usd),
  };
}

function describeForward(resolution: ForwardResolution) {
  return resolution.status === "settled"
    ? { status: resolution.status, event: resolution.eventId, settle_ln: resolution.settleLn }
    : { status: resolution.status };
}

function describeBinary(resolution: BinaryResolution) {
  return resolution.status === "yes"
    ? { status: resolution.status, event: resolution.eventId }
    : { status: resolution.status };
}

function forwardLives(company: string, events: readonly RulebookEvent[]) {
  const binaryEvent = binaryEventOf(company);
  const tDays = FORWARD_T_DAYS[company]!;
  const first = events.find((event) => isPrint(event.eventType, binaryEvent));
  const lives = [];
  // Each life opens on a print; a void lists its successor at expiry, so
  // there is no gap between one life's window and the next.
  let opensAt = first?.announcedAt;
  while (opensAt !== undefined && opensAt <= DATA_THROUGH) {
    const expiresAt = new Date(opensAt.getTime() + tDays * DAY_MS);
    const resolution = resolveForward({ binaryEvent, opensAt, expiresAt }, events, DATA_THROUGH);
    lives.push({
      opens: opensAt.toISOString().slice(0, 10),
      expires: expiresAt.toISOString().slice(0, 10),
      ...describeForward(resolution),
    });
    if (resolution.status === "open") break;
    opensAt = resolution.status === "settled" ? resolution.at : expiresAt;
  }
  return lives;
}

function binaryQuarters(company: string, events: readonly RulebookEvent[]) {
  const binaryEvent = binaryEventOf(company);
  const quarters = [];
  let opensAt = BINARY_START;
  let cutoff = binaryExpiry(opensAt);
  while (opensAt <= DATA_THROUGH) {
    const resolution = resolveBinary({ binaryEvent, opensAt, cutoff }, events, DATA_THROUGH);
    quarters.push({
      quarter_end: cutoff.toISOString().slice(0, 10),
      ...describeBinary(resolution),
    });
    if (resolution.status === "open") break;
    // A successor lists the same day its predecessor resolves or expires
    // and takes the 21-day expiry floor (decision 0002).
    opensAt = resolution.status === "yes" ? resolution.at : cutoff;
    cutoff = binaryExpiry(opensAt);
  }
  return quarters;
}

describe("rulebook against data/round-history/events.csv", () => {
  it("states the binary expiry floor the backtest simulated", () => {
    expect(RULEBOOK.binary.expiry_floor_days).toBe(BINARY_MIN_DAYS);
  });

  it("classifies every row", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const type = eventType(row);
      expect(isPrint(type, binaryEventOf(row.company))).toBe(type === "priced_round");
    }
  });

  it("resolves every listed name's forwards and binaries as recorded", async () => {
    const byCompany = new Map<string, RulebookEvent[]>();
    for (const row of rows) {
      byCompany.set(row.company, [...(byCompany.get(row.company) ?? []), toEvent(row)]);
    }
    const listed = Object.keys(FORWARD_T_DAYS).sort();
    const resolutions = {
      rulebook_version: RULEBOOK_VERSION,
      as_of: DATA_THROUGH.toISOString(),
      rows: rows.map((row) => ({
        company: row.company,
        round: row.round_name,
        date: row.announcement_date,
        event_type: row.event_type,
        print: isPrint(eventType(row), binaryEventOf(row.company)),
        resolves_binary: resolvesBinary(eventType(row), binaryEventOf(row.company)),
      })),
      listed: Object.fromEntries(
        listed.map((company) => {
          const events = byCompany.get(company) ?? [];
          return [
            company,
            {
              binary_event: binaryEventOf(company),
              forward_t_days: FORWARD_T_DAYS[company],
              forwards: forwardLives(company, events),
              binaries: binaryQuarters(company, events),
            },
          ];
        }),
      ),
    };
    await expect(`${JSON.stringify(resolutions, null, 2)}\n`).toMatchFileSnapshot(
      "../fixtures/rulebook-events.json",
    );
  });
});
