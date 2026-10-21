import type { Transaction } from "kysely";

import type { Database, InstrumentKind, QuoteFlagState, QuoteInsert } from "../../db/schema.js";
import {
  binaryQuoteRow,
  forwardQuoteFor,
  forwardQuoteRow,
  LIVE_STATES,
  latestMid,
  latestQuote,
  openForwardInventory,
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

  const requoted: RequoteSummary["requoted"][number][] = [];
  for (const row of rows) {
    const mid = await latestMid(db, row.id, now);
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
      const flagState: QuoteFlagState = row.state === "widened" ? "widened" : "normal";
      const { inventoryCents } = await openForwardInventory(db, row.id);
      next = forwardQuoteRow(
        base,
        forwardQuoteFor(row, mid.mid_ln, inventoryCents, flagState),
        flagState,
      );
    }
    if (sameQuote(await latestQuote(db, row.id), next)) continue;
    await db.insertInto("quotes").values(next).execute();
    requoted.push({ instrument_id: row.id, company: row.company, kind: row.kind });
  }
  return { instruments: rows.length, requoted };
}
