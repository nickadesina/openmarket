import type { Metadata } from "next";
import type { ReactNode } from "react";

import { TournamentNav } from "../../components/tournament-nav/tournament-nav.js";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  title: { default: "Tournament", template: "%s | OpenMarket Tournament" },
  description:
    "A log-scored forecasting tournament on private-company milestones. Forecasts and scores are public.",
};

export default function TournamentLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.layout}>
      <TournamentNav />
      {children}
    </div>
  );
}
