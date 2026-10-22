import { HomeActivity } from "../components/home-activity/home-activity.js";
import { HomeDistribution } from "../components/home-distribution/home-distribution.js";
import { HomeStats } from "../components/home-stats/home-stats.js";
import { HomeTabs } from "../components/home-tabs/home-tabs.js";
import { MarketBoard } from "../components/market-board/market-board.js";
import { getRuntimeDatabase } from "../lib/db/runtime.js";
import { type ActivityPage, getActivity } from "../lib/services/get-activity.js";
import { listMarkets, type MarketListResult } from "../lib/services/list-markets.js";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface HomeData {
  readonly markets?: MarketListResult;
  readonly activity?: ActivityPage;
}

async function loadHomeData(): Promise<HomeData> {
  try {
    const database = getRuntimeDatabase();
    const [markets, activity] = await Promise.allSettled([
      listMarkets(database),
      getActivity(database, { limit: 12 }),
    ]);

    return {
      ...(markets.status === "fulfilled" ? { markets: markets.value } : {}),
      ...(activity.status === "fulfilled" ? { activity: activity.value } : {}),
    };
  } catch {
    return {};
  }
}

export default async function HomePage() {
  const data = await loadHomeData();

  return (
    <div className={styles.page}>
      <HomeStats initialData={data.markets} />

      <div className={styles.workspace}>
        <HomeTabs
          label="Markets"
          tabs={[
            {
              key: "board",
              label: "Board",
              caption: "Each listed name's forward and quarterly binary, by open interest",
              content: <MarketBoard initialData={data.markets} />,
            },
            {
              key: "distribution",
              label: "Distribution",
              caption: "Implied 80% band and median from each forward mid, against the last round",
              content: <HomeDistribution initialData={data.markets} />,
            },
          ]}
        />

        <aside className={styles.activity} aria-labelledby="global-activity-title">
          <h2 id="global-activity-title" className={styles.boxHead}>
            Recent trades
          </h2>
          <HomeActivity initialData={data.activity} />
        </aside>
      </div>

      <p className={styles.disclosure}>
        <strong>Paper trading only.</strong> Prices are the venue&apos;s own model quotes on paper
        money and do not represent an investment, offer, or verified company valuation. Forward
        positions are held to settlement or void.
      </p>
    </div>
  );
}
