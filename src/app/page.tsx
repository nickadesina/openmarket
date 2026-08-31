import { HomeActivity } from "../components/home-activity/home-activity.js";
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
      <header className={styles.header}>
        <div>
          <h1>Valuation markets</h1>
          <p>
            Paper-money markets for the next reported valuation of private
            companies.
          </p>
        </div>
        <span className={styles.refreshNote}>Live data refreshes every 4 seconds</span>
      </header>

      <div className={styles.workspace}>
        <section className={styles.section} aria-labelledby="market-board-title">
          <div className={styles.sectionHeader}>
            <h2 id="market-board-title">Market board</h2>
            <p>Open markets first, ordered by outstanding claims</p>
          </div>
          <MarketBoard initialData={data.markets} />
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
