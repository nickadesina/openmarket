/**
 * Seeds the five demo accounts and their trades (decision 0005):
 *
 *   npm run seed:demo
 *
 * Idempotent: when any demo account already holds a trade it does nothing.
 * It skips, writing nothing and exiting cleanly, when there are no listings
 * or no live quotes (a fresh preview before the dealer job has run). It never
 * forecasts and never touches a tournament question. The production and
 * preview builds run it after `seed:tournament` (scripts/vercel-build.ts).
 *
 * Every trade goes through `executeTrade` or `executeForwardTrade` at the
 * quote the dealer shows at the trade's time; a fill the dealer refuses is
 * logged and skipped. The trades are spread over the last
 * DEMO_HISTORY_DAYS, each book's no earlier than its honest floor (see
 * `honestFloor`), so the charts and the tape show history, not one instant.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { type Kysely, sql } from "kysely";

import { isServiceError } from "../src/lib/api/errors.js";
import { formatCentsAsUsd } from "../src/lib/api/money.js";
import { forwardTradeInputSchema, tradeInputSchema } from "../src/lib/api/schemas.js";
import {
  DEMO_ACCOUNTS,
  DEMO_HISTORY_DAYS,
  DEMO_SEED,
  type DemoTrade,
  demoTradePlan,
  demoTradeTimeline,
} from "../src/lib/config/demo-accounts.js";
import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import type { Database } from "../src/lib/db/schema.js";
import { executeForwardTrade } from "../src/lib/services/dealer/execute-forward-trade.js";
import { getInstrumentQuote } from "../src/lib/services/dealer/get-instrument-quote.js";
import { executeTrade } from "../src/lib/services/execute-trade.js";
import type { ListingView } from "../src/lib/services/get-market.js";
import { listMarkets } from "../src/lib/services/list-markets.js";
import { quoteMarket } from "../src/lib/services/quote.js";
import { ensurePaperAccount } from "../src/lib/services/user.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DemoSeedOptions {
  /** The seed's "now", the end of the history window; the database clock when omitted. */
  readonly now?: Date;
  readonly log?: (line: string) => void;
}

export type DemoSeedOutcome =
  | { readonly outcome: "already_seeded"; readonly trades: number }
  | { readonly outcome: "skipped"; readonly reason: string }
  | {
      readonly outcome: "seeded";
      readonly accounts: number;
      readonly filled: number;
      readonly refused: number;
      /** The earliest and latest fill times; null when nothing filled. */
      readonly from: string | null;
      readonly to: string | null;
    };

/** The demo accounts' trades so far. */
async function demoTradeCount(db: Kysely<Database>): Promise<number> {
  const row = await db
    .selectFrom("trades")
    .innerJoin("users", "users.id", "trades.user_id")
    .innerJoin("tournament_users", "tournament_users.id", "users.tournament_user_id")
    .select(sql<string>`count(*)`.as("count"))
    .where("tournament_users.demo", "=", true)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/** A demo handle a real account already holds; thrown to roll the accounts back. */
class HandleConflict extends Error {
  constructor(readonly handle: string) {
    super(`the handle ${handle} belongs to an account that is not a demo account`);
  }
}

/**
 * The five demo identities and their paper accounts, created in one
 * transaction. A demo identity is a `password`-namespace handle with no
 * credential, so nothing signs in as it. A handle a real account already
 * holds is a conflict: the seed writes nothing and says which.
 */
async function ensureDemoAccounts(db: Kysely<Database>): Promise<string[]> {
  return db.transaction().execute(async (transaction) => {
    const tournamentUserIds: string[] = [];
    for (const account of DEMO_ACCOUNTS) {
      const normalized = account.handle.toLowerCase();
      const existing = await transaction
        .selectFrom("tournament_identities as identities")
        .innerJoin("tournament_users as users", "users.id", "identities.user_id")
        .select(["users.id", "users.demo"])
        .where("identities.provider", "=", "password")
        .where("identities.provider_user_id", "=", normalized)
        .executeTakeFirst();
      if (existing !== undefined && !existing.demo) throw new HandleConflict(account.handle);
      if (existing !== undefined) {
        tournamentUserIds.push(existing.id);
        continue;
      }
      const user = await transaction
        .insertInto("tournament_users")
        .values({ demo: true })
        .returning("id")
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("tournament_identities")
        .values({
          user_id: user.id,
          provider: "password",
          provider_user_id: normalized,
          handle: account.handle,
          handle_normalized: normalized,
          display_name: account.displayName,
          avatar_url: null,
          verified: false,
          provider_created_at: null,
          // Never signed in, and never will (migration 015 refuses its sessions).
          last_login_at: new Date(0),
        })
        .execute();
      tournamentUserIds.push(user.id);
    }
    const paperIds: string[] = [];
    for (const id of tournamentUserIds) paperIds.push(await ensurePaperAccount(transaction, id));
    return paperIds;
  });
}

/**
 * The earliest time a demo trade on this instrument can honestly carry: after
 * its listing and its opening, and after every row already derived from its
 * book's state as of some time (its quote tape, its reference prices, its
 * trades and marks). A fill dated later than all of them sees exactly the
 * state the dealer had then: the model mid in force, the inventory and LMSR
 * book as they stood, no flag change (each posts a quote row). And no row
 * written before the seed ever reads a demo trade, so each still recomputes
 * under `verify:replay`.
 */
async function honestFloor(db: Kysely<Database>, instrumentId: string): Promise<Date> {
  const { rows } = await sql<{ floor: Date }>`
    select greatest(
      listings.listed_at,
      instruments.opens_at,
      (select max(posted_at) from quotes where quotes.instrument_id = instruments.id),
      (select max(as_of) from reference_prices
        where reference_prices.listing_id = instruments.listing_id
          and reference_prices.kind = instruments.kind),
      (select max(created_at) from trades where trades.market_id = markets.id),
      (select max(ts) from marks where marks.market_id = markets.id)
    ) as floor
    from instruments
    join listings on listings.id = instruments.listing_id
    join markets on markets.instrument_id = instruments.id
    where instruments.id = ${instrumentId}
  `.execute(db);
  return new Date(rows[0]!.floor);
}

/** A UUID fixed by the seed and the trade's place in the plan. */
function idempotencyKey(index: number): string {
  const hex = createHash("sha256").update(`openmarket.demo.${DEMO_SEED}.${index}`).digest("hex");
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function usd(dollars: number): string {
  return formatCentsAsUsd(Math.round(dollars * 100));
}

interface TradeContext {
  readonly db: Kysely<Database>;
  readonly userId: string;
  readonly listing: ListingView;
  readonly key: string;
  /** The trade's execution time: every quote it reads and the fill itself. */
  readonly at: Date;
  /** Shares each name's opening binary buy filled, waiting for its match. */
  readonly openerShares: Map<string, number>;
}

/** A forward at the dealer's ask (long) or bid (short) at the trade's time, as the ticket sends it. */
async function tradeForward(
  context: TradeContext,
  trade: Extract<DemoTrade, { kind: "forward" }>,
): Promise<string | null> {
  const instrumentId = context.listing.forward?.instrument_id;
  if (instrumentId === undefined) return "no live forward";
  const quote = await getInstrumentQuote(context.db, instrumentId, {}, context.at);
  if (quote.kind !== "forward") return "not a forward";
  const notional = usd(trade.notionalUsd);
  const input = forwardTradeInputSchema.parse(
    trade.side === "long"
      ? {
          idempotency_key: context.key,
          instrument_id: instrumentId,
          side: "long",
          notional_usd: notional,
          max_entry_ln: quote.ask_ln,
        }
      : {
          idempotency_key: context.key,
          instrument_id: instrumentId,
          side: "short",
          notional_usd: notional,
          min_entry_ln: quote.bid_ln,
        },
  );
  await executeForwardTrade(context.db, context.userId, input, { now: context.at });
  return null;
}

/** A binary buy spends a fixed amount, its own max cost, as a spend order does. */
async function buyBinary(
  context: TradeContext,
  trade: Extract<DemoTrade, { kind: "binary_buy" }>,
): Promise<string | null> {
  const marketId = context.listing.binary?.market_id;
  if (marketId === undefined) return "no live binary";
  const spend = usd(trade.spendUsd);
  const input = tradeInputSchema.parse({
    idempotency_key: context.key,
    market_id: marketId,
    side: trade.side,
    strike_index: 0,
    action: "buy",
    spend_usd: spend,
    max_cost_usd: spend,
  });
  const { result } = await executeTrade(context.db, context.userId, input, { now: context.at });
  context.openerShares.set(trade.slug, result.shares);
  return null;
}

/** The other side of a name's opening buy, share for share, at its quoted cost. */
async function matchBinary(
  context: TradeContext,
  trade: Extract<DemoTrade, { kind: "binary_match" }>,
): Promise<string | null> {
  const marketId = context.listing.binary?.market_id;
  if (marketId === undefined) return "no live binary";
  const quantity = context.openerShares.get(trade.slug);
  context.openerShares.delete(trade.slug);
  if (quantity === undefined) return "its opening buy did not fill";
  const quoted = await quoteMarket(
    context.db,
    { market_id: marketId, side: trade.side, strike_index: 0, action: "buy", quantity },
    context.userId,
    context.at,
  );
  const input = tradeInputSchema.parse({
    idempotency_key: context.key,
    market_id: marketId,
    side: trade.side,
    strike_index: 0,
    action: "buy",
    quantity,
    max_cost_usd: formatCentsAsUsd(Number(quoted.cash_amount_cents)),
  });
  await executeTrade(context.db, context.userId, input, { now: context.at });
  return null;
}

/** A binary sell of part of the side the account holds more of, at its quoted proceeds. */
async function sellBinary(
  context: TradeContext,
  trade: Extract<DemoTrade, { kind: "binary_sell" }>,
): Promise<string | null> {
  const marketId = context.listing.binary?.market_id;
  if (marketId === undefined) return "no live binary";
  const holding = await context.db
    .selectFrom("holdings")
    .select("h")
    .where("user_id", "=", context.userId)
    .where("market_id", "=", marketId)
    .executeTakeFirst();
  const [no = 0, yes = 0] = holding?.h ?? [];
  const side = yes >= no ? "yes" : "no";
  const quantity = Math.floor(Math.max(yes, no) * trade.fraction * 10_000) / 10_000;
  if (quantity < 0.0001) return "nothing to sell";
  const quoted = await quoteMarket(
    context.db,
    { market_id: marketId, side, strike_index: 0, action: "sell", quantity },
    context.userId,
    context.at,
  );
  const input = tradeInputSchema.parse({
    idempotency_key: context.key,
    market_id: marketId,
    side,
    strike_index: 0,
    action: "sell",
    quantity,
    min_proceeds_usd: formatCentsAsUsd(Number(quoted.cash_amount_cents)),
  });
  await executeTrade(context.db, context.userId, input, { now: context.at });
  return null;
}

/** Places one planned trade: null when it filled, else why it did not. */
async function placeTrade(context: TradeContext, trade: DemoTrade): Promise<string | null> {
  try {
    if (trade.kind === "forward") return await tradeForward(context, trade);
    if (trade.kind === "binary_buy") return await buyBinary(context, trade);
    if (trade.kind === "binary_match") return await matchBinary(context, trade);
    return await sellBinary(context, trade);
  } catch (error) {
    // The dealer's refusal (cap, price band, a moved quote) is its call; anything else is a bug.
    if (isServiceError(error)) return `${error.code}: ${error.message}`;
    throw error;
  }
}

/** The instrument a planned trade fills on: the name's live forward or binary. */
function instrumentOf(listing: ListingView, trade: DemoTrade): string | null {
  return trade.kind === "forward"
    ? (listing.forward?.instrument_id ?? null)
    : (listing.binary?.instrument_id ?? null);
}

async function databaseNow(db: Kysely<Database>): Promise<Date> {
  const { ts } = await db
    .selectNoFrom(sql<Date>`clock_timestamp()`.as("ts"))
    .executeTakeFirstOrThrow();
  return new Date(ts);
}

/**
 * Each trade's time: its book's window runs from the later of its honest
 * floor and DEMO_HISTORY_DAYS ago to now, and the trade sits at its fixed
 * place on the timeline, so each book's trades keep plan order in time.
 */
function tradeTime(floor: Date, now: Date, fraction: number): Date {
  const start = Math.max(floor.getTime() + 1, now.getTime() - DEMO_HISTORY_DAYS * DAY_MS);
  if (start >= now.getTime()) return now;
  return new Date(Math.round(start + (now.getTime() - start) * fraction));
}

export async function seedDemo(
  db: Kysely<Database>,
  options: DemoSeedOptions = {},
): Promise<DemoSeedOutcome> {
  const log = options.log ?? (() => undefined);
  const existing = await demoTradeCount(db);
  if (existing > 0) return { outcome: "already_seeded", trades: existing };

  const now = options.now ?? (await databaseNow(db));
  const markets = await listMarkets(db, { now });
  if (markets.listings.length === 0) return { outcome: "skipped", reason: "no listings" };
  const live = markets.listings.filter(
    (listing) => listing.forward !== null || listing.binary !== null,
  );
  if (live.length === 0) return { outcome: "skipped", reason: "no live quotes" };

  // Every floor is read before the first demo write, which would move it.
  const floors = new Map<string, Date>();
  for (const listing of live) {
    for (const instrumentId of [listing.forward?.instrument_id, listing.binary?.instrument_id]) {
      if (instrumentId !== undefined) floors.set(instrumentId, await honestFloor(db, instrumentId));
    }
  }

  let accounts: string[];
  try {
    accounts = await ensureDemoAccounts(db);
  } catch (error) {
    if (error instanceof HandleConflict) return { outcome: "skipped", reason: error.message };
    throw error;
  }

  const bySlug = new Map(live.map((listing) => [listing.company.slug, listing]));
  const plan = demoTradePlan([...bySlug.keys()]);
  const timeline = demoTradeTimeline(plan.length);
  const openerShares = new Map<string, number>();
  const filledAt: number[] = [];
  let refused = 0;
  for (const [index, trade] of plan.entries()) {
    const listing = bySlug.get(trade.slug)!;
    const instrumentId = instrumentOf(listing, trade);
    const at =
      instrumentId === null ? now : tradeTime(floors.get(instrumentId)!, now, timeline[index]!);
    const reason = await placeTrade(
      {
        db,
        userId: accounts[trade.account]!,
        listing,
        key: idempotencyKey(index),
        at,
        openerShares,
      },
      trade,
    );
    if (reason === null) {
      filledAt.push(at.getTime());
    } else {
      refused += 1;
      log(
        `skipped: ${trade.slug} ${trade.kind} for ${DEMO_ACCOUNTS[trade.account]!.handle}: ${reason}`,
      );
    }
  }
  return {
    outcome: "seeded",
    accounts: accounts.length,
    filled: filledAt.length,
    refused,
    from: filledAt.length === 0 ? null : new Date(Math.min(...filledAt)).toISOString(),
    to: filledAt.length === 0 ? null : new Date(Math.max(...filledAt)).toISOString(),
  };
}

async function main(): Promise<void> {
  const db = createDirectDatabase();
  try {
    const result = await seedDemo(db, { log: (line) => console.log(line) });
    if (result.outcome === "already_seeded") {
      console.log(
        `Demo seed: the demo accounts already hold ${result.trades} trades; nothing done`,
      );
    } else if (result.outcome === "skipped") {
      console.log(`Demo seed skipped: ${result.reason}; nothing written`);
    } else {
      console.log(
        `Demo seed: ${result.accounts} demo accounts, ${result.filled} trades filled ` +
          `from ${result.from} to ${result.to}, ${result.refused} refused by the dealer or skipped`,
      );
    }
  } finally {
    await destroyDatabase(db);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error: unknown) {
    console.error("Demo seed failed:", error instanceof Error ? error.message : "");
    process.exitCode = 1;
  }
}
