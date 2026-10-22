import { notFound } from "next/navigation";
import { MarketWorkspace } from "../../../components/market-workspace/market-workspace.js";
import { isServiceError } from "../../../lib/api/errors.js";
import { getRuntimeDatabase } from "../../../lib/db/runtime.js";
import { type ActivityPage, getActivity } from "../../../lib/services/get-activity.js";
import { getMarket, type ListingDetail } from "../../../lib/services/get-market.js";
import { getMarks, type MarkHistory } from "../../../lib/services/get-marks.js";

export const metadata = { title: "Market" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MarketPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

interface InitialMarketData {
  readonly listing: ListingDetail | null;
  readonly marks: MarkHistory | null;
  readonly activity: ActivityPage | null;
}

const INITIAL_RANGE = "1w";

async function loadInitialMarket(slug: string): Promise<InitialMarketData> {
  try {
    const database = getRuntimeDatabase();
    const [listing, activity] = await Promise.all([
      getMarket(database, slug),
      getActivity(database, { slug, limit: 25 }),
    ]);
    const marks =
      listing.forward === null
        ? null
        : await getMarks(database, listing.forward.market_id, INITIAL_RANGE);
    return { listing, marks, activity };
  } catch (error) {
    if (isServiceError(error) && error.code === "MARKET_NOT_FOUND") notFound();
    return { listing: null, marks: null, activity: null };
  }
}

export default async function MarketPage({ params }: MarketPageProps) {
  const { slug } = await params;
  const initial = await loadInitialMarket(slug);

  return (
    <MarketWorkspace
      slug={slug}
      initialListing={initial.listing}
      initialMarks={initial.marks}
      initialActivity={initial.activity}
    />
  );
}
