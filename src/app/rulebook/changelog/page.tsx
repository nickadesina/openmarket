import type { Metadata } from "next";
import Link from "next/link";

import { DocumentBody } from "../../../components/document/document.js";
import { RULEBOOK_VERSION } from "../../../lib/engine/rulebook.js";
import { RULEBOOK_CHANGELOG_PATH, readRepoDoc } from "../../../lib/tradeables/repo-docs.js";
import styles from "../page.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Rulebook changelog",
  description: "Every published version of OpenMarket's settlement rulebook, newest first.",
  robots: { index: false, follow: false },
};

export default function RulebookChangelogPage() {
  return (
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.sectionLabel}>Settlement rulebook</p>
        <h1>Rulebook changelog</h1>
        <p className={styles.links}>
          <Link className={styles.link} href="/rulebook">
            Rulebook v{RULEBOOK_VERSION}
          </Link>
        </p>
      </header>
      <DocumentBody source={readRepoDoc(RULEBOOK_CHANGELOG_PATH)} skipTitle />
    </article>
  );
}
