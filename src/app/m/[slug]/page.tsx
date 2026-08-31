import { MarketWorkspace } from "../../../components/market-workspace/market-workspace.js";
import { getRuntimeDatabase } from "../../../lib/db/runtime.js";
import { getMarket, type MarketDetail } from "../../../lib/services/get-market.js";
import { getMarks, type MarkHistory } from "../../../lib/services/get-marks.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MarketPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

interface InitialMarketData {
  readonly market: MarketDetail | null;
  readonly marks: MarkHistory | null;
}

async function loadInitialMarket(slug: string): Promise<InitialMarketData> {
  try {
    const database = getRuntimeDatabase();
    const [market, marks] = await Promise.all([
      getMarket(database, slug),
      getMarks(database, slug, "1d"),
    ]);
    return { market, marks };
  } catch {
    return { market: null, marks: null };
  }
}

export default async function MarketPage({ params }: MarketPageProps) {
  const { slug } = await params;
  const initial = await loadInitialMarket(slug);

  return <MarketWorkspace slug={slug} initialMarket={initial.market} initialMarks={initial.marks} />;
}
