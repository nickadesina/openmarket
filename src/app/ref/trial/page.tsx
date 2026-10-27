import type { Metadata } from "next";
import Link from "next/link";

import { DocumentBody } from "../../../components/document/document.js";
import { documentTitle, FEED_TRIAL_PATH, readRepoDoc } from "../../../lib/tradeables/repo-docs.js";
import styles from "../page.module.css";

export const dynamic = "force-static";

const source = readRepoDoc(FEED_TRIAL_PATH);

export const metadata: Metadata = {
  title: "Reference feed trial",
  description:
    "The design-partner trial of OpenMarket's reference feed: what a partner gets, agrees to, and what it is not.",
  robots: { index: false, follow: false },
};

/** docs/tradeables/feed-trial.md, rendered as written. */
export default function FeedTrialPage() {
  return (
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.sectionLabel}>Reference API</p>
        <h1>{documentTitle(source)}</h1>
        <p className={styles.links}>
          <Link className={styles.link} href="/ref">
            API docs
          </Link>
        </p>
      </header>
      <DocumentBody source={source} skipTitle />
    </article>
  );
}
