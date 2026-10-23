import type { Transaction } from "kysely";
import { DEALER_PARAMS } from "../../config/dealer.js";
import type { Database, InstrumentRow, ListingRow, QuoteFlagState } from "../../db/schema.js";
import {
  FLAG_KINDS,
  type FlagKind,
  flagWidens,
  type InstrumentSnapshot,
  type LifecycleEffect,
  type LifecycleEvent,
  transition,
} from "../../engine/dealer/lifecycle.js";
import { RULEBOOK } from "../../engine/dealer/rulebook.js";
import {
  forwardQuoteFor,
  forwardQuoteRow,
  isWidened,
  LIVE_STATES,
  latestMid,
  openForwardInventory,
} from "./dealer-books.js";
import { lifecycleSnapshot } from "./service-helpers.js";

/**
 * The state step of /api/cron/dealer (CONTRACTS.md → The dealer, Lifecycle):
 * lifecycle.ts's `transition` over the widening flags observed since each
 * live forward's last state change, its latest model mid, and the clock.
 * A flag widens the forward (s × 3, Q ÷ 2 for new positions) until a newer
 * mid re-prices it or the hold passes. The binary is never widened, so only
 * forwards move here. Resolution and expiry are the settle job's: a tick past
 * T is not applied.
 *
 * A flag's time is when it was observed: the dealer cannot widen before it
 * knew. widened_until is that time plus flag_hours, so the latest widening
 * flag's time is widened_until − flag_hours and needs no column.
 */

const DAY_MS = 86_400_000;
const WIDENING_KINDS = FLAG_KINDS.filter(flagWidens);

export interface StateChange {
  readonly instrument_id: string;
  readonly company: string;
  readonly from: InstrumentRow["state"];
  readonly to: InstrumentRow["state"];
  readonly widened_until: Date | null;
  readonly flags: number;
}

export interface ApplyFlagsSummary {
  readonly forwards: number;
  readonly changes: readonly StateChange[];
}

type LiveForward = InstrumentRow & {
  readonly company_id: string;
  readonly company: string;
  readonly listing: Pick<ListingRow, "tier" | "kappa" | "cap_cents" | "gamma" | "spread_floor">;
};

async function liveForwards(db: Transaction<Database>): Promise<LiveForward[]> {
  const rows = await db
    .selectFrom("instruments")
    .innerJoin("listings", "listings.id", "instruments.listing_id")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .selectAll("instruments")
    .select([
      "listings.company_id",
      "companies.name as company",
      "listings.tier",
      "listings.kappa",
      "listings.cap_cents",
      "listings.gamma",
      "listings.spread_floor",
    ])
    .where("instruments.kind", "=", "forward")
    .where("instruments.state", "in", LIVE_STATES)
    .orderBy("companies.name")
    .forUpdate("instruments")
    .execute();
  return rows.map(({ tier, kappa, cap_cents, gamma, spread_floor, ...instrument }) => ({
    ...instrument,
    listing: { tier, kappa, cap_cents, gamma, spread_floor },
  }));
}

/** The instrument's last state change: its latest list, widen or restore quote. */
async function lastStateChange(db: Transaction<Database>, instrument: LiveForward): Promise<Date> {
  const row = await db
    .selectFrom("quotes")
    .select("posted_at")
    .where("instrument_id", "=", instrument.id)
    .where("reason", "in", ["list", "widen", "restore"])
    .orderBy("posted_at", "desc")
    .orderBy("sequence", "desc")
    .executeTakeFirst();
  return row?.posted_at ?? instrument.opens_at;
}

function eventTime(event: LifecycleEvent): number {
  return (event.type === "tick" ? event.now : event.at).getTime();
}

/**
 * Applies the events in time order (a mid before a flag at the same instant,
 * so a tie stays widened), then a tick unless T's grace has passed.
 */
export function replayLifecycle(
  start: InstrumentSnapshot,
  events: readonly LifecycleEvent[],
  now: Date,
  flagHours: number,
): { readonly instrument: InstrumentSnapshot; readonly effects: LifecycleEffect[] } {
  const ordered = [...events].sort(
    (a, b) => eventTime(a) - eventTime(b) || Number(a.type === "flag") - Number(b.type === "flag"),
  );
  const pastGrace =
    now.getTime() > start.expiresAt.getTime() + RULEBOOK.observation_grace_days * DAY_MS;
  let instrument = start;
  const effects: LifecycleEffect[] = [];
  for (const event of [...ordered, ...(pastGrace ? [] : [{ type: "tick", now } as const])]) {
    const next = transition(instrument, event, { flagHours });
    if (next.instrument.state === "resolved" || next.instrument.state === "expired") break;
    instrument = next.instrument;
    effects.push(...next.effects);
  }
  return { instrument, effects };
}

async function applyOne(
  db: Transaction<Database>,
  instrument: LiveForward,
  now: Date,
  flagHours: number,
): Promise<StateChange | null> {
  const since = await lastStateChange(db, instrument);
  const flags = await db
    .selectFrom("event_flags")
    .select(["kind", "observed_at"])
    .where("company_id", "=", instrument.company_id)
    .where("kind", "in", WIDENING_KINDS)
    .where("observed_at", ">", since)
    .where("observed_at", "<=", now)
    .execute();
  const mid = await latestMid(db, instrument.id, now);
  const events: LifecycleEvent[] = flags.map((flag) => ({
    type: "flag",
    at: flag.observed_at,
    kind: flag.kind as FlagKind,
  }));
  if (mid !== undefined) events.push({ type: "remid", at: mid.computed_at });

  const result = replayLifecycle(lifecycleSnapshot(instrument, flagHours), events, now, flagHours);
  const next = result.instrument;
  const before = instrument.state === "widened" ? instrument.widened_until : null;
  if (next.state === instrument.state && next.widenedUntil?.getTime() === before?.getTime()) {
    return null;
  }

  await db
    .updateTable("instruments")
    .set({ state: next.state, widened_until: next.widenedUntil })
    .where("id", "=", instrument.id)
    .execute();
  if (mid?.mid_ln != null) {
    const flagState: QuoteFlagState = isWidened(
      { state: next.state, widened_until: next.widenedUntil },
      now,
    )
      ? "widened"
      : "normal";
    const { inventoryCents } = await openForwardInventory(db, instrument.id);
    const quoted = forwardQuoteFor(instrument.listing, mid.mid_ln, inventoryCents, flagState);
    await db
      .insertInto("quotes")
      .values(
        forwardQuoteRow(
          {
            instrumentId: instrument.id,
            postedAt: now,
            reason: next.state === "widened" ? "widen" : "restore",
            modelMidId: mid.id,
          },
          quoted,
          flagState,
        ),
      )
      .execute();
  }
  return {
    instrument_id: instrument.id,
    company: instrument.company,
    from: instrument.state,
    to: next.state,
    widened_until: next.widenedUntil,
    flags: flags.length,
  };
}

export async function applyFlags(
  db: Transaction<Database>,
  now: Date,
  flagHours: number = DEALER_PARAMS.dealer.flag_hours,
): Promise<ApplyFlagsSummary> {
  const forwards = await liveForwards(db);
  const changes: StateChange[] = [];
  for (const instrument of forwards) {
    const change = await applyOne(db, instrument, now, flagHours);
    if (change !== null) changes.push(change);
  }
  return { forwards: forwards.length, changes };
}
