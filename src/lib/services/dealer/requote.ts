import { sql, type Transaction } from "kysely";

import type { Database, InstrumentKind, QuoteFlagState, QuoteInsert } from "../../db/schema.js";
import {
  binaryQuoteRow,
  forwardQuoteFor,
  forwardQuoteRow,
  isWidened,
  LIVE_STATES,
  sameQuote,
} from "./dealer-books.js";

/**
 * The requote step of /api/cron/dealer, last so it reads this run's state and
 * mids: every live forward's two-way quote from its latest mid, its open
 * inventory (I = Σ short − Σ long notional), its listing's parameters and
 * its flag state; every live binary's LMSR YES price. A `requote` row is
 * appended only when the quote differs from the instrument's latest one, so
 * the tape moves when the dealer does.
 */

export interface RequoteSummary {
  readonly instruments: number;
  readonly requoted: readonly {
    readonly instrument_id: string;
    readonly company: string;
    readonly kind: InstrumentKind;
  }[];
}

export async function requote(db: Transaction<Database>, now: Date): Promise<RequoteSummary> {
  const rows = await db
    .selectFrom("instruments")
    .innerJoin("listings", "listings.id", "instruments.listing_id")
    .innerJoin("companies", "companies.id", "listings.company_id")
    .innerJoin("markets", "markets.instrument_id", "instruments.id")
    .select([
      "instruments.id",
      "instruments.kind",
      "instruments.state",
      "instruments.widened_until",
      "companies.name as company",
      "listings.tier",
      "listings.kappa",
      "listings.cap_cents",
      "listings.gamma",
      "listings.spread_floor",
      "markets.current_metric",
    ])
    .where("instruments.state", "in", LIVE_STATES)
    .orderBy("companies.name")
    .orderBy("instruments.kind")
    .execute();

  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return { instruments: 0, requoted: [] };
  const [mids, quotes, inventories] = await Promise.all([
    db
      .selectFrom("model_mids")
      .selectAll()
      .where("instrument_id", "in", ids)
      .where("computed_at", "<=", now)
      .distinctOn("instrument_id")
      .orderBy("instrument_id")
      .orderBy("computed_at", "desc")
      .orderBy("id", "desc")
      .execute(),
    db
      .selectFrom("quotes")
      .selectAll()
      .where("instrument_id", "in", ids)
      .distinctOn("instrument_id")
      .orderBy("instrument_id")
      .orderBy("posted_at", "desc")
      .orderBy("sequence", "desc")
      .execute(),
    db
      .selectFrom("forward_positions")
      .select([
        "instrument_id",
        sql<string>`sum(case when side = 'short' then notional_cents else -notional_cents end)::text`.as(
          "inventory",
        ),
      ])
      .where("instrument_id", "in", ids)
      .where("settled_at", "is", null)
      .where("voided_at", "is", null)
      .groupBy("instrument_id")
      .execute(),
  ]);
  const midByInstrument = new Map(mids.map((row) => [row.instrument_id, row]));
  const quoteByInstrument = new Map(quotes.map((row) => [row.instrument_id, row]));
  const inventoryByInstrument = new Map(
    inventories.map((row) => [row.instrument_id, Number(row.inventory)]),
  );
  const requoted: RequoteSummary["requoted"][number][] = [];
  for (const row of rows) {
    const mid = midByInstrument.get(row.id);
    if (mid === undefined) continue;
    const base = {
      instrumentId: row.id,
      postedAt: now,
      reason: "requote" as const,
      modelMidId: mid.id,
    };
    let next: QuoteInsert;
    if (row.kind === "binary") {
      next = binaryQuoteRow(base, row.current_metric);
    } else {
      if (mid.mid_ln === null) continue;
      const flagState: QuoteFlagState = isWidened(row, now) ? "widened" : "normal";
      const inventoryCents = inventoryByInstrument.get(row.id) ?? 0;
      next = forwardQuoteRow(
        base,
        forwardQuoteFor(row, mid.mid_ln, inventoryCents, flagState),
        flagState,
      );
    }
    if (sameQuote(quoteByInstrument.get(row.id), next)) continue;
    await db.insertInto("quotes").values(next).execute();
    requoted.push({ instrument_id: row.id, company: row.company, kind: row.kind });
  }
  return { instruments: rows.length, requoted };
}
