import type { Metadata } from "next";
import Link from "next/link";

import { DocumentBody } from "../../components/document/document.js";
import styles from "../../components/index/index.module.css";
import { Versions } from "../../components/index/versions.js";
import { METHODOLOGY } from "../../lib/engine/index/methodology.js";
import { RULEBOOK_VERSION } from "../../lib/engine/rulebook.js";
import { METHODOLOGY_PATH, withLiveConstants } from "../../lib/tradeables/methodology-doc.js";
import { readRepoDoc } from "../../lib/tradeables/repo-docs.js";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How OpenMarket turns public filings into the index: the unit, security labels, filer families, consensus, dispersion, mark versus print, revisions, the SPV premium and the common-equivalent, with every constant.",
  robots: { index: false, follow: false },
};

export default function MethodologyPage() {
  return (
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.crumb}>Methodology</p>
        <h1>OpenMarket methodology</h1>
        <p className={styles.muted}>
          METHODOLOGY.md as it stands in this build. Its Constants table is rebuilt from the
          engine's exported constants, so the values below are the ones every payload is computed
          with; <Link href="/api/ref/methodology">/api/ref/methodology</Link> publishes them as JSON
          with the listing dates and the filer-families file.
        </p>
        <Versions
          versions={{
            methodology_version: METHODOLOGY.methodology_version,
            ce_version: METHODOLOGY.ce_version,
            rulebook_version: RULEBOOK_VERSION,
          }}
        />
      </header>
      <DocumentBody source={withLiveConstants(readRepoDoc(METHODOLOGY_PATH))} skipTitle />
    </article>
  );
}
