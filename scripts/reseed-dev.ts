/**
 * Rebuilds the development database with plausible market state:
 *
 *   1. wipes every trading table;
 *   2. seeds the Anthropic and Stripe markets on their real last-round anchors;
 *   3. replays a scripted two-week trading narrative through the real
 *      execution service (so the ledger, holdings, and marks are genuine);
 *   4. backdates the resulting trades and marks in sequence order so history
 *      spans the period instead of a single burst.
 *
 * Run against DATABASE_URL_UNPOOLED, then `npm run verify:replay` and refresh
 * scripts/dev-seed.sql with the pg_dump command documented in seed-dev.ts.
 */
import { randomUUID } from "node:crypto";

import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { VALUATION_BOUNDARIES_USD } from "../src/lib/engine/buckets.js";
import { executeTrade } from "../src/lib/services/execute-trade.js";
import { seedMarket } from "../src/lib/services/seed-market.js";
import { createOrResumeUser } from "../src/lib/services/user.js";

const DAYS = 16;
const TRADE_COUNT = 84;

const MARKETS = [
  {
    name: "Anthropic",
    slug: "anthropic",
    logo_path: "/logos/anthropic.svg",
    metric_kind: "valuation_median" as const,
    anchor_valuation_usd: "965000000000.00",
    anchor_date: "2026-05-28",
    anchor_description:
      "Series H post-money valuation; $65B raised, led by Altimeter, Dragoneer, Greenoaks, and Sequoia (Anthropic newsroom, May 28, 2026).",
    sigma: 0.35,
    b: 25_000,
    // The narrative: IPO filing optimism drifts the median above the round.
    target: 1_120_000_000_000,
    weight: 0.6,
  },
  {
    name: "Stripe",
    slug: "stripe",
    logo_path: "/logos/stripe.svg",
    metric_kind: "valuation_median" as const,
    anchor_valuation_usd: "159000000000.00",
    anchor_date: "2026-02-24",
    anchor_description:
      "Employee tender offer valuation led by Thrive Capital, Coatue, and Andreessen Horowitz (Feb 24, 2026).",
    sigma: 0.4,
    b: 15_000,
    target: 170_000_000_000,
    weight: 0.4,
  },
];

const USERS = [
  "quantquokka",
  "marketmaven",
  "indexindia",
  "diamondhandz",
  "bearishbeth",
  "roundtripper",
  "sigma_sam",
  "tenderwatch",
];

// Deterministic so the snapshot is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nearestStrike(valuationUsd: number): number {
  let best = 0;
  VALUATION_BOUNDARIES_USD.forEach((boundary, index) => {
    if (
      Math.abs(Math.log(boundary / valuationUsd)) <
      Math.abs(Math.log(VALUATION_BOUNDARIES_USD[best]! / valuationUsd))
    )
      best = index;
  });
  return best;
}

interface Position {
  readonly userId: string;
  readonly slug: string;
  readonly side: "yes" | "no";
  readonly strikeIndex: number;
  shares: number;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one linear narrative script; split into seed/trade/backdate phases before it grows.
async function main(): Promise<void> {
  const db = createDirectDatabase();
  const random = mulberry32(20260901);
  try {
    // Row deletes rather than TRUNCATE: a running dev server polls these
    // tables, and TRUNCATE's exclusive locks deadlock against its readers.
    await db.transaction().execute(async (transaction) => {
      for (const table of [
        "marks",
        "trades",
        "holdings",
        "settlements",
        "markets",
        "companies",
        "users",
      ] as const) {
        await transaction.deleteFrom(table).execute();
      }
    });

    for (const market of MARKETS) {
      const { target: _t, weight: _w, ...input } = market;
      await seedMarket(db, input);
    }
    const users = await Promise.all(USERS.map((username) => createOrResumeUser(db, username)));

    const positions: Position[] = [];
    for (let index = 0; index < TRADE_COUNT; index += 1) {
      const market = random() < MARKETS[0]!.weight ? MARKETS[0]! : MARKETS[1]!;
      const user = users[Math.floor(random() * users.length)]!;
      const state = await db
        .selectFrom("markets")
        .innerJoin("companies", "companies.id", "markets.company_id")
        .select("markets.current_metric")
        .where("companies.slug", "=", market.slug)
        .executeTakeFirstOrThrow();
      const money = nearestStrike(Number(state.current_metric));
      const held = positions.filter(
        (position) =>
          position.userId === user.id && position.slug === market.slug && position.shares > 1,
      );
      const wantsSell = held.length > 0 && random() < 0.18;

      if (wantsSell) {
        const position = held[Math.floor(random() * held.length)]!;
        // Sellable quantity comes from the holdings vector, not the tracked
        // total: buying both sides redeems shares and shrinks the vector.
        const marketRow = await db
          .selectFrom("markets")
          .innerJoin("companies", "companies.id", "markets.company_id")
          .select("markets.id")
          .where("companies.slug", "=", market.slug)
          .executeTakeFirstOrThrow();
        const holding = await db
          .selectFrom("holdings")
          .select("h")
          .where("user_id", "=", user.id)
          .where("market_id", "=", marketRow.id)
          .executeTakeFirst();
        const buckets = holding?.h ?? [];
        const covered =
          position.side === "yes"
            ? buckets.slice(position.strikeIndex + 1)
            : buckets.slice(0, position.strikeIndex + 1);
        const sellable = covered.length === 0 ? 0 : Math.min(...covered);
        if (sellable < 1) {
          position.shares = 0;
          continue;
        }
        const quantity = Number(
          (Math.min(sellable, position.shares) * (0.3 + random() * 0.6)).toFixed(6),
        );
        const { result } = await executeTrade(db, user.id, {
          slug: market.slug,
          action: "sell",
          side: position.side,
          strike_index: position.strikeIndex,
          quantity,
          min_proceeds_usd: "0.00",
          idempotency_key: randomUUID(),
        });
        position.shares -= result.shares;
        continue;
      }

      // A mean-reverting walk around the narrative target: mostly bulls while
      // below it, mostly bears above it, never one-sided.
      const bullish = random() < (Number(state.current_metric) < market.target ? 0.72 : 0.38);
      // Bulls buy YES at the money or one strike above; bears buy NO at the
      // money or one strike below. Wider offsets pile mass into the tails.
      const offset = Math.floor(random() * 2) * (bullish ? 1 : -1);
      const strikeIndex = Math.min(
        VALUATION_BOUNDARIES_USD.length - 1,
        Math.max(0, money + offset),
      );
      const spend = Math.exp(Math.log(40) + random() * (Math.log(3_500) - Math.log(40)));
      const spendUsd = (Math.round(spend * 100) / 100).toFixed(2);
      const side = bullish ? "yes" : "no";
      const { result } = await executeTrade(db, user.id, {
        slug: market.slug,
        action: "buy",
        side,
        strike_index: strikeIndex,
        spend_usd: spendUsd,
        max_cost_usd: spendUsd,
        idempotency_key: randomUUID(),
      });
      const existing = positions.find(
        (position) =>
          position.userId === user.id &&
          position.slug === market.slug &&
          position.side === side &&
          position.strikeIndex === strikeIndex,
      );
      if (existing === undefined)
        positions.push({
          userId: user.id,
          slug: market.slug,
          side,
          strikeIndex,
          shares: result.shares,
        });
      else existing.shares += result.shares;
    }

    // Backdate in execution order: most of the period is quiet trading days,
    // the last dozen trades land inside 24 hours, and the final three inside
    // the past hour so every quote-sheet window has observations.
    const trades = await db
      .selectFrom("trades")
      .select(["id", "created_at"])
      .orderBy("created_at", "asc")
      .execute();
    const now = Date.now();
    const start = now - DAYS * 86_400_000;
    const timestamps = trades
      .map((_trade, index) => {
        const remaining = trades.length - index;
        if (remaining <= 3)
          return now - remaining * 14 * 60_000 - Math.floor(random() * 5 * 60_000);
        if (remaining <= 14)
          return (
            now - 60 * 60_000 - (remaining - 3) * 95 * 60_000 - Math.floor(random() * 20 * 60_000)
          );
        const span = now - 24 * 60 * 60_000 - start;
        const t = (index + random() * 0.8) / (trades.length - 14);
        const day = Math.floor(t * (DAYS - 1));
        const hour = 9 + random() * 10; // business-hours clustering
        return (
          start +
          day * 86_400_000 +
          Math.floor(hour * 3_600_000) +
          Math.floor(random() * 3_600_000) +
          Math.floor(span * 0)
        );
      })
      .sort((a, b) => a - b);
    for (const [index, trade] of trades.entries()) {
      const ts = new Date(timestamps[index]!);
      await db.updateTable("trades").set({ created_at: ts }).where("id", "=", trade.id).execute();
      await db.updateTable("marks").set({ ts }).where("trade_id", "=", trade.id).execute();
    }
    const opened = new Date(start - 86_400_000);
    await db.updateTable("markets").set({ created_at: opened }).execute();
    // The seed mark (sequence 0, no trade) must precede every trade mark.
    await db.updateTable("marks").set({ ts: opened }).where("trade_id", "is", null).execute();
    await db.updateTable("companies").set({ created_at: opened }).execute();
    for (const [index, user] of users.entries()) {
      await db
        .updateTable("users")
        .set({ created_at: new Date(start + index * 3_600_000) })
        .where("id", "=", user.id)
        .execute();
    }

    const summary = await db
      .selectFrom("markets")
      .innerJoin("companies", "companies.id", "markets.company_id")
      .select(["companies.name", "markets.current_metric", "markets.last_market_sequence"])
      .execute();
    console.log(
      JSON.stringify({ trades: trades.length, users: users.length, markets: summary }, null, 2),
    );
  } finally {
    await destroyDatabase(db);
  }
}

await main();
