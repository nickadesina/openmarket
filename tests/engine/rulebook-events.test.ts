import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  EVENT_TYPES,
  type EventType,
  isPrint,
  isRepricing,
  type NameKind,
  observedQuarterEnd,
  RULEBOOK_VERSION,
  type RulebookEvent,
  resolvePrints,
  resolveRepricing,
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
 * row enters as rank 1. The labs (an IPO is also a print) are the two names
 * v1 listed as labs.
 */
const LABS = new Set(["OpenAI", "Anthropic"]);
const DATA_THROUGH = new Date(`${DATA_THROUGH_DATE}T23:59:59Z`);
/** The first quarter a contract on the index is replayed for. */
const FIRST_QUARTER = new Date("2024-01-01T00:00:00Z");

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

function nameKindOf(company: string): NameKind {
  return LABS.has(company) ? "lab" : "company";
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

const day = (at: Date) => at.toISOString().slice(0, 10);

function prints(company: string, events: readonly RulebookEvent[]) {
  return resolvePrints(nameKindOf(company), events, DATA_THROUGH).map((print) => ({
    event: print.eventId,
    date: day(print.at),
    rank: print.rank,
    settle_ln: Math.log(print.postMoneyUsd),
    final: print.final,
  }));
}

/**
 * One contract per calendar quarter, each listed at the previous quarter's
 * cutoff, so a quarter's window is the whole quarter: whether a repricing
 * event voids it.
 */
function quarters(events: readonly RulebookEvent[]) {
  const replayed = [];
  let opensAt = new Date(FIRST_QUARTER.getTime() - 1);
  while (opensAt <= DATA_THROUGH) {
    const cutoff = observedQuarterEnd(opensAt);
    const resolution = resolveRepricing({ opensAt, cutoff }, events, DATA_THROUGH);
    replayed.push({
      quarter_end: day(cutoff),
      status: resolution.status,
      ...(resolution.status === "void" ? { event: resolution.eventId } : {}),
    });
    opensAt = cutoff;
  }
  return replayed;
}

describe("rulebook against data/round-history/events.csv", () => {
  it("classifies every row", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const type = eventType(row);
      expect(isPrint(type, nameKindOf(row.company))).toBe(type === "priced_round");
    }
  });

  it("resolves every name's prints and quarters as recorded", async () => {
    const byCompany = new Map<string, RulebookEvent[]>();
    for (const row of rows) {
      byCompany.set(row.company, [...(byCompany.get(row.company) ?? []), toEvent(row)]);
    }
    const resolutions = {
      rulebook_version: RULEBOOK_VERSION,
      as_of: DATA_THROUGH.toISOString(),
      rows: rows.map((row) => ({
        company: row.company,
        round: row.round_name,
        date: row.announcement_date,
        event_type: row.event_type,
        print: isPrint(eventType(row), nameKindOf(row.company)),
        repricing: isRepricing(eventType(row)),
      })),
      names: Object.fromEntries(
        [...byCompany.keys()].sort().map((company) => {
          const events = byCompany.get(company)!;
          return [
            company,
            {
              name_kind: nameKindOf(company),
              prints: prints(company, events),
              quarters: quarters(events),
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
