import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { DocumentBody, headingId, parseDocument } from "../../components/document/document.js";
import { NOT_BUILT, RULEBOOK, RULEBOOK_VERSION, sourceRank } from "../../lib/engine/rulebook.js";
import { RULEBOOK_REVIEWERS_PATH, readRepoDoc } from "../../lib/tradeables/repo-docs.js";
import {
  anchorOf,
  labelOf,
  notBuiltNote,
  quantity,
  RULEBOOK_SECTIONS,
  type RulePath,
  ruleAt,
} from "../../lib/tradeables/rulebook-sections.js";
import styles from "./page.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Rulebook",
  description:
    "OpenMarket's rulebook: what a print is, how each source class ranks within its purpose, and the rules every contract on the index shares.",
  robots: { index: false, follow: false },
};

const ACCESS_LABEL: Readonly<Record<string, string>> = {
  free: "Free",
  paid_per_document: "Paid per document",
  public_page: "Public page",
};

/** Each purpose's ranking: what it establishes, then its classes in rank order. */
function SourcePurposes() {
  const documentOf = new Map(
    RULEBOOK.source_classes.map((row) => [row.source_class as string, row.document]),
  );
  return (
    <div className={styles.purposes}>
      {RULEBOOK.source_purposes.map((purpose) => (
        <div key={purpose.purpose} id={`purpose-${anchorOf([purpose.purpose])}`}>
          <p>
            <code>{purpose.purpose}</code> {purpose.establishes}
          </p>
          <div className={styles.scroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Class</th>
                  <th scope="col">Document</th>
                </tr>
              </thead>
              <tbody>
                {purpose.ranks.map((row) => (
                  <tr key={row.source_class}>
                    <td className={styles.num}>{row.rank}</td>
                    <td>
                      <code>{row.source_class}</code>
                    </td>
                    <td>{documentOf.get(row.source_class)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {"note" in purpose ? <p className={styles.muted}>{purpose.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

/** One row per source class: the rank ingest stores for it, its cadence, lag and access. */
function SourceClasses() {
  return (
    <div className={styles.scroller}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Class</th>
            <th scope="col">Stored rank</th>
            <th scope="col">Cadence</th>
            <th scope="col">Lag</th>
            <th scope="col">Access</th>
          </tr>
        </thead>
        <tbody>
          {RULEBOOK.source_classes.map((row) => (
            <tr key={row.source_class}>
              <td>
                <code>{row.source_class}</code>
              </td>
              <td>
                <span className={styles.num}>{sourceRank(row.source_class)}</span> in{" "}
                <code>{row.purpose}</code>
              </td>
              <td>{row.cadence}</td>
              <td>{row.lag}</td>
              <td>{ACCESS_LABEL[row.access]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rules whose value is a table, by path. */
const TABLES: Readonly<Record<string, () => ReactNode>> = {
  source_purposes: SourcePurposes,
  source_classes: SourceClasses,
};

function value(path: RulePath, rule: unknown): ReactNode {
  const table = TABLES[path.join(".")];
  if (table !== undefined) return table();
  if (typeof rule === "string") return <p>{rule}</p>;
  if (typeof rule === "number") return <p>{quantity(path.at(-1)!, rule)}</p>;
  if (Array.isArray(rule)) {
    if (rule.every((item) => typeof item === "string")) {
      return (
        <ul>
          {rule.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    }
    return (
      <ol>
        {(rule as readonly { readonly rank: number; readonly source: string }[]).map((item) => (
          <li key={item.rank} value={item.rank}>
            {item.source}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <dl className={styles.values}>
      {Object.entries(rule as Record<string, unknown>).map(([key, child]) => (
        <div key={key}>
          <dt>{labelOf([key])}</dt>
          <dd>{typeof child === "number" ? quantity(key, child) : String(child)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Rule({ path, sectionId }: { readonly path: RulePath; readonly sectionId: string }) {
  const anchor = anchorOf(path);
  const note = notBuiltNote(path);
  return (
    <div className={styles.rule} id={anchor === sectionId ? undefined : anchor}>
      <h3 className={styles.ruleLabel}>
        <a className={styles.anchor} href={`#${anchor}`}>
          {labelOf(path)}
        </a>
        {note === undefined ? null : <span className={styles.notBuilt}>Not built</span>}
      </h3>
      <div className={styles.ruleText}>
        {value(path, ruleAt(path))}
        {note === undefined ? null : <p className={styles.notBuiltNote}>{note}</p>}
      </div>
    </div>
  );
}

export default function RulebookPage() {
  const reviewers = readRepoDoc(RULEBOOK_REVIEWERS_PATH);
  const reviewed = parseDocument(reviewers).some(
    (block) => block.kind === "table" && block.rows.length > 0,
  );

  return (
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.sectionLabel}>Settlement rulebook</p>
        <h1>Rulebook</h1>
        <dl className={styles.versions}>
          <div>
            <dt>Rulebook</dt>
            <dd>{RULEBOOK_VERSION}</dd>
          </div>
        </dl>
        <p>
          What a print is and how its sources rank; how each mark-side source class ranks within the
          purpose it serves; and the rules every contract on the index shares. OpenMarket quotes,
          lists and settles none of those contracts. Rules marked not built are the contracts'
          intent; the code does not serve them yet.
        </p>
        <p className={styles.links}>
          <a className={styles.link} href="/api/ref/rulebook">
            JSON
          </a>
          <Link className={styles.link} href="/rulebook/changelog">
            Changelog
          </Link>
          <a className={styles.link} href="#reviewed-by">
            Reviewed by
          </a>
        </p>
      </header>

      <div className={styles.layout}>
        <div className={styles.sections}>
          {RULEBOOK_SECTIONS.map((section) => {
            const id = headingId(section.title);
            return (
              <section key={id} id={id} className={styles.section} aria-labelledby={`${id}-head`}>
                <h2 className={styles.sectionLabel} id={`${id}-head`}>
                  <a className={styles.anchor} href={`#${id}`}>
                    {section.title}
                  </a>
                </h2>
                {section.rules.map((path) => (
                  <Rule key={path.join(".")} path={path} sectionId={id} />
                ))}
              </section>
            );
          })}
        </div>

        <aside className={styles.aside} aria-labelledby="not-built">
          <h2 className={styles.sectionLabel} id="not-built">
            Not built
          </h2>
          {NOT_BUILT.length === 0 ? <p className={styles.muted}>None at this version.</p> : null}
          <ul className={styles.notBuiltList}>
            {NOT_BUILT.map((entry) => (
              <li key={entry.rule}>
                <a className={styles.link} href={`#${anchorOf(entry.rule.split("."))}`}>
                  {labelOf(entry.rule.split("."))}
                </a>
                <p>{entry.note}</p>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <section className={styles.section} id="reviewed-by" aria-labelledby="reviewed-by-head">
        <h2 className={styles.sectionLabel} id="reviewed-by-head">
          Reviewed by
        </h2>
        <DocumentBody source={reviewers} skipTitle />
        {reviewed ? null : <p className={styles.muted}>No review filed yet.</p>}
      </section>
    </article>
  );
}
