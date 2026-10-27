import type { Metadata } from "next";

import { RULEBOOK_VERSION } from "../../lib/engine/dealer/rulebook.js";
import {
  LICENSE,
  MARKDOWN_PATH,
  publishedLabel,
  RULEBOOK_PATH,
  resolutionSources,
  UNKNOWN,
} from "../../lib/tradeables/resolution-sources.js";
import styles from "./page.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Resolution sources",
  description:
    "How each venue that prices private-company valuations settles, and where OpenMarket sits.",
  robots: { index: false, follow: false },
};

export default function ResolutionSourcesPage() {
  const { file, rows } = resolutionSources();

  return (
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.sectionLabel}>Resolution sources</p>
        <h1>How private-company valuation venues settle</h1>
        <p>
          One row per venue or product that prices a private company's valuation. OpenMarket's row
          is computed from its rulebook. Rows marked unverified have not been confirmed against a
          primary source. "{UNKNOWN}" marks a field the research did not establish.
        </p>
      </header>

      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Venue</th>
              <th scope="col">Product</th>
              <th scope="col">Instrument</th>
              <th scope="col">Settles on</th>
              <th scope="col">Published</th>
              <th scope="col">Revision window</th>
              <th scope="col">Void rule</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.venue}>
                <th scope="row">
                  <a className={styles.link} href={`#${anchor(row.venue)}`}>
                    {row.venue}
                  </a>
                  {row.needs_check ? <span className={styles.unverified}>Unverified</span> : null}
                </th>
                <td>{row.product}</td>
                <td>{row.instrument}</td>
                <td>{row.settlement_source}</td>
                <td>{publishedLabel(row)}</td>
                <td className={row.revision_window === null ? styles.muted : undefined}>
                  {row.revision_window ?? UNKNOWN}
                </td>
                <td className={row.void_rule === null ? styles.muted : undefined}>
                  {row.void_rule ?? UNKNOWN}
                </td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className={styles.section} aria-labelledby="notes">
        <h2 className={styles.sectionLabel} id="notes">
          Notes
        </h2>
        <dl className={styles.notes}>
          {rows.map((row) => (
            <div key={row.venue} id={anchor(row.venue)}>
              <dt>{row.venue}</dt>
              <dd>
                <p>
                  {row.notes}
                  {row.launched === null ? "" : ` Launched ${row.launched}.`}
                  {row.verified === null ? "" : ` Sources read ${row.verified}.`}
                </p>
                {row.sources.length > 0 ? (
                  <ol className={styles.sources}>
                    {row.sources.map((source) => (
                      <li key={source}>
                        <a className={styles.link} href={source} rel="noopener noreferrer">
                          {source}
                        </a>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="context">
        <h2 className={styles.sectionLabel} id="context">
          Context
        </h2>
        <dl className={styles.notes}>
          {file.context.map((item) => (
            <div key={item.item}>
              <dt>{item.item}</dt>
              <dd>
                <p>{item.summary}</p>
                <ol className={styles.sources}>
                  {item.sources.map((source) => (
                    <li key={source}>
                      <a className={styles.link} href={source} rel="noopener noreferrer">
                        {source}
                      </a>
                    </li>
                  ))}
                </ol>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className={styles.footer}>
        <span>
          Rulebook{" "}
          <a className={styles.link} href={RULEBOOK_PATH}>
            v{RULEBOOK_VERSION}
          </a>
        </span>
        <span>Data as of {file.as_of}</span>
        <a className={styles.link} href={MARKDOWN_PATH}>
          Markdown export
        </a>
        <span>{LICENSE}</span>
      </footer>
    </article>
  );
}

function anchor(venue: string): string {
  return venue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
