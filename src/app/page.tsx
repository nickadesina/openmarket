import { HomeActivity } from "../components/home-activity/home-activity.js";
import { HomeDistribution } from "../components/home-distribution/home-distribution.js";
import { HomeQuoteSheet } from "../components/home-quote-sheet/home-quote-sheet.js";
import { HomeStats } from "../components/home-stats/home-stats.js";
import { MarketBoard } from "../components/market-board/market-board.js";
import { getRuntimeDatabase } from "../lib/db/runtime.js";
import { getActivity, type ActivityPage } from "../lib/services/get-activity.js";
import {
  listMarkets,
  type MarketListResult,
} from "../lib/services/list-markets.js";
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
        <section className={styles.section} aria-labelledby="market-board-title">
          <div className={styles.sectionHeader}>
            <h2 id="market-board-title">Market board</h2>
            <p>Open markets first, ordered by outstanding claims</p>
          </div>
          <MarketBoard initialData={data.markets} />

          <div className={styles.sectionHeader}>
            <h2 id="distribution-title">Where the market lands</h2>
            <p>80% probability band, median, and the last public round on one log axis</p>
          </div>
          <HomeDistribution initialData={data.markets} />

          <div className={styles.sectionHeader}>
            <h2 id="quote-sheet-title">Quote sheet</h2>
            <p>Change, high, and low over the past hour, day, week, and all time</p>
          </div>
          <HomeQuoteSheet initialData={data.markets} />
        </section>

        <aside className={styles.activity} aria-labelledby="global-activity-title">
          <div className={styles.sectionHeader}>
            <h2 id="global-activity-title">Global activity</h2>
            <p>Recent public executions</p>
          </div>
          <HomeActivity initialData={data.activity} />
        </aside>
      </div>

      <p className={styles.disclosure}>
        <strong>Paper trading only.</strong> Market values reflect participant
        positions and do not represent an investment, offer, or verified company
        valuation.
      </p>
    </div>
  );
}
