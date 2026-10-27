import type { Metadata } from "next";
import Link from "next/link";

import { DocumentBody, parseDocument } from "../../components/document/document.js";
import { MODEL_VERSION } from "../../lib/config/dealer.js";
import { RULEBOOK_VERSION } from "../../lib/engine/dealer/rulebook.js";
import { readRepoDoc } from "../../lib/tradeables/repo-docs.js";
import styles from "../rulebook/page.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "For policy",
  description:
    "A US founder building valuation contracts on private companies: the contracts, the rulebook, the open classification question, and what OpenMarket will supply for a comment letter.",
  robots: { index: false, follow: false },
};

const CASE_STUDY = readRepoDoc("docs/tradeables/case-study.md");
const ROUND_HISTORY = JSON.parse(readRepoDoc("public/data/round-history.json")) as {
  readonly as_of: string;
  readonly rows: number;
  readonly license: string;
};

/**
 * docs/tradeables/case-study.md as written, except its Links section, which
 * the page builds from the repository: the live rulebook version and the
 * datasets as they are served, so the page never cites a version or a file
 * that is not live.
 */
function splitLinks(source: string): string {
  const at = source.search(/^## Links$/m);
  return at === -1 ? source : source.slice(0, at);
}

export default function ForPolicyPage() {
  const title = parseDocument(CASE_STUDY).find(
    (block) => block.kind === "heading" && block.level === 1,
  );
  return (
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.sectionLabel}>For policy</p>
        <h1>{title?.kind === "heading" ? title.text : "OpenMarket"}</h1>
        <dl className={styles.versions}>
          <div>
            <dt>Rulebook</dt>
            <dd>{RULEBOOK_VERSION}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{MODEL_VERSION}</dd>
          </div>
        </dl>
      </header>

      <DocumentBody source={splitLinks(CASE_STUDY)} skipTitle />

      <section className={styles.section} aria-labelledby="links">
        <h2 className={styles.sectionLabel} id="links">
          Links
        </h2>
        <ul className={styles.notBuiltList}>
          <li>
            Rulebook v{RULEBOOK_VERSION}:{" "}
            <Link className={styles.link} href="/rulebook">
              /rulebook
            </Link>{" "}
            and{" "}
            <a className={styles.link} href="/api/ref/rulebook">
              /api/ref/rulebook
            </a>
          </li>
          <li>
            Round-history dataset, {ROUND_HISTORY.rows} rows through {ROUND_HISTORY.as_of}:{" "}
            <a className={styles.link} href="/data/round-history.csv">
              /data/round-history.csv
            </a>{" "}
            and{" "}
            <a className={styles.link} href="/data/round-history.json">
              /data/round-history.json
            </a>{" "}
            ({ROUND_HISTORY.license})
          </li>
          <li>
            The backtest's public outputs:{" "}
            <a className={styles.link} href="/data/backtest/README.md">
              /data/backtest
            </a>
          </li>
          <li>
            Resolution-source map:{" "}
            <Link className={styles.link} href="/resolution-sources">
              /resolution-sources
            </Link>
          </li>
          <li>
            Reference API:{" "}
            <Link className={styles.link} href="/ref">
              /ref
            </Link>
          </li>
        </ul>
      </section>
    </article>
  );
}
