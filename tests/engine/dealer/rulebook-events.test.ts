import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEALER_PARAMS } from "../../../src/lib/config/dealer.js";
import {
  type BinaryEvent,
  type BinaryResolution,
  EVENT_TYPES,
  type EventType,
  type ForwardResolution,
  isPrint,
  quarterEndCutoff,
  RULEBOOK_VERSION,
  type RulebookEvent,
  resolveBinary,
  resolveForward,
  resolvesBinary,
} from "../../../src/lib/engine/dealer/rulebook.js";

/**
 * backtest/events.csv is the fixture every rulebook change must still resolve
 * (README D13). The resolutions are recorded in
 * tests/fixtures/rulebook-events.json; a rule change that moves any of them
 * re-baselines that file (`vitest -u`) in the same commit, so the diff is the
 * review.
 *
 * events.csv records announced closes and carries no source rank, so every
 * row enters as rank 1. The labs are the names whose binary is a public S-1.
 */
const LABS = new Set(["OpenAI", "Anthropic"]);
const DATA_THROUGH = new Date(`${DEALER_PARAMS.data_through}T23:59:59Z`);
const BINARY_START = new Date("2024-01-01T00:00:00Z");
const DAY_MS = 86_400_000;

interface EventRow {
  readonly company: string;
  readonly event_type: string;
  readonly round_name: string;
  readonly announcement_date: string;
  readonly post_money_usd: string;
}

function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field !== "" || record.length > 0) records.push([...record, field]);
  const [header, ...rows] = records;
  return rows.map((row) => Object.fromEntries(header!.map((name, i) => [name, row[i] ?? ""])));
}

const rows = parseCsv(readFileSync("backtest/events.csv", "utf8")) as unknown as EventRow[];

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
  const tDays = DEALER_PARAMS.forward_t_days[company]!;
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
  let cutoff = quarterEndCutoff(opensAt);
  while (opensAt <= DATA_THROUGH) {
    const resolution = resolveBinary({ binaryEvent, opensAt, cutoff }, events, DATA_THROUGH);
    quarters.push({
      quarter_end: cutoff.toISOString().slice(0, 10),
      ...describeBinary(resolution),
    });
    if (resolution.status === "open") break;
    // An early YES lists the next quarter's binary the same day.
    opensAt = resolution.status === "yes" ? resolution.at : cutoff;
    cutoff = quarterEndCutoff(new Date(cutoff.getTime() + DAY_MS));
  }
  return quarters;
}

describe("rulebook against backtest/events.csv", () => {
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
    const listed = Object.keys(DEALER_PARAMS.forward_t_days).sort();
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
              forward_t_days: DEALER_PARAMS.forward_t_days[company],
              forwards: forwardLives(company, events),
              binaries: binaryQuarters(company, events),
            },
          ];
        }),
      ),
    };
    await expect(`${JSON.stringify(resolutions, null, 2)}\n`).toMatchFileSnapshot(
      "../../fixtures/rulebook-events.json",
    );
  });
});
