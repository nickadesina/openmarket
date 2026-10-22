/**
 * Seeds the five demo accounts and their trades (decision 0005):
 *
 *   npm run seed:demo
 *
 * Idempotent: when any demo account already holds a trade it does nothing.
 * It skips, writing nothing and exiting cleanly, when there are no listings
 * or no live quotes (a fresh preview before the dealer job has run). Every
 * trade goes through `executeTrade` or `executeForwardTrade` at the dealer's
 * live quote; a fill the dealer refuses is logged and skipped. It never
 * forecasts and never touches a tournament question. The production and
 * preview builds run it after `seed:tournament` (scripts/vercel-build.ts).
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { type Kysely, sql } from "kysely";

import { isServiceError } from "../src/lib/api/errors.js";
import { formatCentsAsUsd } from "../src/lib/api/money.js";
import { forwardTradeInputSchema, tradeInputSchema } from "../src/lib/api/schemas.js";
import {
  DEMO_ACCOUNTS,
  DEMO_SEED,
  type DemoTrade,
  demoTradePlan,
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

export interface DemoSeedOptions {
  /** Each service call's clock; the database clock when omitted. Tests step a fixture calendar. */
  readonly clock?: () => Date;
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
  readonly clock: (() => Date) | undefined;
  /** Shares each name's opening binary buy filled, waiting for its match. */
  readonly openerShares: Map<string, number>;
}

function at(clock: (() => Date) | undefined): { now?: Date } {
  return clock === undefined ? {} : { now: clock() };
}

/** A forward at the dealer's live ask (long) or bid (short), as the ticket sends it. */
async function tradeForward(
  context: TradeContext,
  trade: Extract<DemoTrade, { kind: "forward" }>,
): Promise<string | null> {
  const instrumentId = context.listing.forward?.instrument_id;
  if (instrumentId === undefined) return "no live forward";
  const quote = await getInstrumentQuote(
    context.db,
    instrumentId,
    {},
    context.clock === undefined ? new Date() : context.clock(),
  );
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
  await executeForwardTrade(context.db, context.userId, input, at(context.clock));
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
  const { result } = await executeTrade(context.db, context.userId, input, at(context.clock));
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
    context.clock === undefined ? new Date() : context.clock(),
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
  await executeTrade(context.db, context.userId, input, at(context.clock));
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
    context.clock === undefined ? new Date() : context.clock(),
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
  await executeTrade(context.db, context.userId, input, at(context.clock));
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

export async function seedDemo(
  db: Kysely<Database>,
  options: DemoSeedOptions = {},
): Promise<DemoSeedOutcome> {
  const log = options.log ?? (() => undefined);
  const existing = await demoTradeCount(db);
  if (existing > 0) return { outcome: "already_seeded", trades: existing };

  const markets = await listMarkets(db, at(options.clock));
  if (markets.listings.length === 0) return { outcome: "skipped", reason: "no listings" };
  const live = markets.listings.filter(
    (listing) => listing.forward !== null || listing.binary !== null,
  );
  if (live.length === 0) return { outcome: "skipped", reason: "no live quotes" };

  let accounts: string[];
  try {
    accounts = await ensureDemoAccounts(db);
  } catch (error) {
    if (error instanceof HandleConflict) return { outcome: "skipped", reason: error.message };
    throw error;
  }

  const bySlug = new Map(live.map((listing) => [listing.company.slug, listing]));
  const openerShares = new Map<string, number>();
  let filled = 0;
  let refused = 0;
  for (const [index, trade] of demoTradePlan([...bySlug.keys()]).entries()) {
    const reason = await placeTrade(
      {
        db,
        userId: accounts[trade.account]!,
        listing: bySlug.get(trade.slug)!,
        key: idempotencyKey(index),
        clock: options.clock,
        openerShares,
      },
      trade,
    );
    if (reason === null) {
      filled += 1;
    } else {
      refused += 1;
      log(
        `skipped: ${trade.slug} ${trade.kind} for ${DEMO_ACCOUNTS[trade.account]!.handle}: ${reason}`,
      );
    }
  }
  return { outcome: "seeded", accounts: accounts.length, filled, refused };
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
        `Demo seed: ${result.accounts} demo accounts, ${result.filled} trades filled, ` +
          `${result.refused} refused by the dealer or skipped`,
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
