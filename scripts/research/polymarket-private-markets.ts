/**
 * Every Polymarket market whose question names a private company on the
 * pipeline's list (OpenAI, Anthropic, Stripe, Databricks, Kraken, SpaceX,
 * xAI), from Polymarket's public APIs, for the resolution-quality read
 * (docs/prompts/tradeables, "Research scripts"). Private: nothing here is
 * published until Nick reads it.
 *
 *   npx tsx scripts/research/polymarket-private-markets.ts
 *
 * Writes docs/research/polymarket-private-markets.csv and
 * docs/research/polymarket-private-markets.README.md. Idempotent: each run
 * rewrites both, rows in a fixed order, and records when it fetched.
 *
 * Sources:
 * - Gamma, https://gamma-api.polymarket.com/public-search: events and their
 *   markets by keyword, closed ones included; a market is kept when its own
 *   question names the company.
 * - CLOB, https://clob.polymarket.com/prices-history: the YES token's daily
 *   price history; the last point at or before the market's close is its last
 *   price before close. Markets still open get Gamma's last trade price only.
 */
import { getJson, politeFetcher, writeCsv, writeText } from "./lib.js";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const CSV = "docs/research/polymarket-private-markets.csv";
const README = "docs/research/polymarket-private-markets.README.md";
const PAGE_SIZE = 50;

/** Company, and how its name is matched in a question (word boundaries). */
const COMPANIES: readonly (readonly [string, RegExp])[] = [
  ["OpenAI", /\bOpenAI\b/i],
  ["Anthropic", /\bAnthropic\b/i],
  ["Stripe", /\bStripe\b/i],
  ["Databricks", /\bDatabricks\b/i],
  ["Kraken", /\bKraken\b/i],
  ["SpaceX", /\bSpace ?X\b/i],
  ["xAI", /\bxAI\b/],
];

/** Questions about valuation, a round, a listing or an acquisition: the ones the read is about. */
const VALUATION_TOPIC =
  /\b(IPO|valuation|valued|market cap|funding|round|raise[sd]?|acquir\w*|S-1|list(s|ed|ing)? on|public|tender|post-money)\b/i;

const COLUMNS = [
  "company",
  "valuation_topic",
  "event_slug",
  "event_title",
  "market_id",
  "market_slug",
  "condition_id",
  "question",
  "resolution_source",
  "resolution_text",
  "start_date",
  "end_date",
  "closed",
  "closed_time",
  "uma_resolution_status",
  "outcomes",
  "outcome",
  "final_prices",
  "volume_usd",
  "last_trade_price",
  "last_yes_price_before_close",
  "last_yes_price_at",
] as const;

interface GammaMarket {
  readonly id: string;
  readonly slug?: string;
  readonly conditionId?: string;
  readonly question?: string;
  readonly description?: string;
  readonly resolutionSource?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly closed?: boolean;
  readonly closedTime?: string;
  readonly umaResolutionStatus?: string;
  readonly outcomes?: string;
  readonly outcomePrices?: string;
  readonly clobTokenIds?: string;
  readonly volumeNum?: number;
  readonly lastTradePrice?: number;
}

interface GammaEvent {
  readonly slug: string;
  readonly title: string;
  readonly resolutionSource?: string;
  readonly markets?: readonly GammaMarket[];
}

interface SearchPage {
  readonly events?: readonly GammaEvent[];
  readonly pagination?: { readonly hasMore?: boolean };
}

const get = politeFetcher({ minGapMs: 100, headers: { Accept: "application/json" } });

function parseList(value: string | undefined): string[] {
  if (value === undefined || value === "") return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

/** The resolved outcome: the one whose final price is 1, once UMA has resolved it. */
function resolvedOutcome(market: GammaMarket): string {
  if (market.umaResolutionStatus !== "resolved") return "";
  const outcomes = parseList(market.outcomes);
  const prices = parseList(market.outcomePrices).map(Number);
  const winner = prices.indexOf(1);
  return winner === -1 ? "" : (outcomes[winner] ?? "");
}

async function searchEvents(term: string): Promise<GammaEvent[]> {
  const events: GammaEvent[] = [];
  for (let page = 1; ; page += 1) {
    const url = `${GAMMA}/public-search?q=${encodeURIComponent(term)}&events_status=all&limit_per_type=${PAGE_SIZE}&page=${page}`;
    const body = await getJson<SearchPage>(get, url);
    events.push(...(body.events ?? []));
    if (body.pagination?.hasMore !== true || (body.events ?? []).length === 0) return events;
  }
}

async function lastYesPriceBeforeClose(
  market: GammaMarket,
): Promise<{ readonly price: number | null; readonly at: string }> {
  const yesToken = parseList(market.clobTokenIds)[0];
  const closedAt = Date.parse(market.closedTime ?? market.endDate ?? "");
  if (yesToken === undefined || !market.closed || Number.isNaN(closedAt)) {
    return { price: null, at: "" };
  }
  const body = await getJson<{ history?: { t: number; p: number }[] }>(
    get,
    `${CLOB}/prices-history?market=${yesToken}&interval=max&fidelity=1440`,
  );
  const before = (body.history ?? []).filter((point) => point.t * 1000 <= closedAt).at(-1);
  return before === undefined
    ? { price: null, at: "" }
    : { price: before.p, at: new Date(before.t * 1000).toISOString() };
}

function marketRow(
  company: string,
  event: GammaEvent,
  market: GammaMarket,
  last: { readonly price: number | null; readonly at: string },
): Record<string, unknown> {
  const question = market.question ?? "";
  return {
    company,
    valuation_topic: VALUATION_TOPIC.test(question) ? "yes" : "no",
    event_slug: event.slug,
    event_title: event.title,
    market_id: market.id,
    market_slug: market.slug ?? "",
    condition_id: market.conditionId ?? "",
    question,
    resolution_source: market.resolutionSource || event.resolutionSource || "",
    resolution_text: market.description ?? "",
    start_date: market.startDate ?? "",
    end_date: market.endDate ?? "",
    closed: market.closed === true ? "yes" : "no",
    closed_time: market.closedTime ?? "",
    uma_resolution_status: market.umaResolutionStatus ?? "",
    outcomes: parseList(market.outcomes).join("|"),
    outcome: resolvedOutcome(market),
    final_prices: parseList(market.outcomePrices).join("|"),
    volume_usd: market.volumeNum ?? "",
    last_trade_price: market.lastTradePrice ?? "",
    last_yes_price_before_close: last.price ?? "",
    last_yes_price_at: last.at,
  };
}

/** One company's markets: those in its search results whose own question names it. */
async function companyRows(
  company: string,
  pattern: RegExp,
): Promise<{ readonly rows: Record<string, unknown>[]; readonly events: number }> {
  const events = await searchEvents(company);
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    for (const market of event.markets ?? []) {
      if (!pattern.test(market.question ?? "") || seen.has(market.id)) continue;
      seen.add(market.id);
      rows.push(marketRow(company, event, market, await lastYesPriceBeforeClose(market)));
    }
  }
  return { rows, events: events.length };
}

function readme(fetchedAt: string, counts: readonly string[], total: number): string {
  return `# Polymarket markets on private companies

Fetched ${fetchedAt} by \`scripts/research/polymarket-private-markets.ts\`. Private research input; not published.

What it pulled: every market whose own question names OpenAI, Anthropic, Stripe, Databricks, Kraken, SpaceX or xAI, found through Polymarket's public Gamma search (${GAMMA}/public-search, open and closed events). One row per market and company; a market that names two companies appears under each.

- \`resolution_source\` is the market's (or its event's) resolution source field as Gamma returns it, often empty; \`resolution_text\` is the market's description, which carries the resolution rules.
- \`outcome\` is the outcome whose final price is 1 once UMA marks the market resolved; empty otherwise.
- \`last_yes_price_before_close\` is the YES token's last daily point at or before the market's close, from the CLOB price history (${CLOB}/prices-history, fidelity one day). Open markets have Gamma's \`last_trade_price\` only.
- \`valuation_topic\` flags questions about valuation, rounds, listings or acquisitions, by keyword; the rest (model releases, benchmarks) are kept for completeness.

Counts this run:
${counts.join("\n")}
- ${total} rows in all.
`;
}

async function main(): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  const counts: string[] = [];
  for (const [company, pattern] of COMPANIES) {
    const found = await companyRows(company, pattern);
    rows.push(...found.rows);
    counts.push(`- ${company}: ${found.rows.length} markets from ${found.events} matching events.`);
    console.log(`${company}: ${found.rows.length} markets`);
  }
  rows.sort(
    (a, b) =>
      String(a.company).localeCompare(String(b.company)) ||
      String(a.end_date).localeCompare(String(b.end_date)) ||
      String(a.market_id).localeCompare(String(b.market_id)),
  );
  writeCsv(CSV, COLUMNS, rows);
  writeText(README, readme(fetchedAt, counts, rows.length));
  console.log(`wrote ${CSV} (${rows.length} rows) and ${README}`);
}

try {
  await main();
} catch (error: unknown) {
  console.error("Polymarket pull failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
