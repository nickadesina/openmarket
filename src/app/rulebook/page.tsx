import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { DocumentBody, headingId, parseDocument } from "../../components/document/document.js";
import { MODEL_VERSION } from "../../lib/config/dealer.js";
import { NOT_BUILT, RULEBOOK_VERSION } from "../../lib/engine/dealer/rulebook.js";
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
    "OpenMarket's settlement rulebook: what is a print, how sources rank, and how each contract resolves.",
  robots: { index: false, follow: false },
};

function value(path: RulePath, rule: unknown): ReactNode {
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
          <div>
            <dt>Model</dt>
            <dd>{MODEL_VERSION}</dd>
          </div>
        </dl>
        <p>Rules marked not built are the contract's intent; the code does not enforce them yet.</p>
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
