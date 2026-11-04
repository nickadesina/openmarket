import type { Metadata } from "next";
import Link from "next/link";

import styles from "./page.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: { absolute: "OpenMarket" },
  description:
    "A published index of private-company marks, built only from public filings (decision 0003).",
  robots: { index: false, follow: false },
};

/** A holding page until the daily index page lands (docs/prompts/v2, P5). */
export default function HomePage() {
  return (
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.sectionLabel}>Marks index</p>
        <h1>OpenMarket</h1>
        <p>
          OpenMarket is a published index of private-company marks, built only from public filings.
        </p>
      </header>
      <nav aria-label="Published documents">
        <ul className={styles.links}>
          <li>
            <Link className={styles.link} href="/rulebook">
              Rulebook
            </Link>
          </li>
          <li>
            <Link className={styles.link} href="/resolution-sources">
              Resolution sources
            </Link>
          </li>
          <li>
            <Link className={styles.link} href="/ref">
              Reference API
            </Link>
          </li>
        </ul>
      </nav>
    </article>
  );
}
