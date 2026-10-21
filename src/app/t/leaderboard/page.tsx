import { LeaderboardPage } from "../../../components/tournament-leaderboard/leaderboard-page.js";
import { getRuntimeDatabase } from "../../../lib/db/runtime.js";
import {
  getLeaderboard,
  LEADERBOARD_PERIOD_PATTERN,
  type Leaderboard,
  listLeaderboardPeriods,
} from "../../../lib/services/tournament/leaderboard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Leaderboard" };

interface LeaderboardRouteProps {
  readonly searchParams: Promise<{ readonly period?: string }>;
}

export default async function LeaderboardRoute({ searchParams }: LeaderboardRouteProps) {
  const { period: requested } = await searchParams;
  const period =
    requested !== undefined && LEADERBOARD_PERIOD_PATTERN.test(requested) ? requested : "all";
  let leaderboard: Leaderboard | null = null;
  let periods = ["all"];
  try {
    const database = getRuntimeDatabase();
    [leaderboard, periods] = await Promise.all([
      getLeaderboard(database, period),
      listLeaderboardPeriods(database),
    ]);
  } catch {
    // The client query retries; the page still renders its shell.
  }
  if (!periods.includes(period)) periods = [...periods, period];
  return <LeaderboardPage period={period} periods={periods} initialLeaderboard={leaderboard} />;
}
