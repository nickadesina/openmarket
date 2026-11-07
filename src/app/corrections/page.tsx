import type { Metadata } from "next";
import Link from "next/link";

import { DocumentBody } from "../../components/document/document.js";
import { formatCount, formatInstant, plural } from "../../components/index/format.js";
import styles from "../../components/index/index.module.css";
import { Versions } from "../../components/index/versions.js";
import { getRuntimeDatabase } from "../../lib/db/runtime.js";
import { getRefCorrections, type RefCorrection } from "../../lib/services/index/ref-corrections.js";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Corrections",
  description:
    "Every correction OpenMarket has published, newest first: what changed, why, the diff and the rows it touched. Rows are superseded, never edited.",
  robots: { index: false, follow: false },
};

/** Where corrections are reported: a public GitHub issue form (.github/ISSUE_TEMPLATE/correction.yml). */
const REPORT_URL = "https://github.com/nickadesina/openmarket/issues/new?template=correction.yml";

const KIND_TEXT: Readonly<Record<RefCorrection["kind"], string>> = {
  row: "Row: a filing read wrong",
  methodology: "Methodology: a rule or constant changed",
  parser: "Parser: a reading rule changed",
};

/** Every page of the corrections log; the log is short and the page shows all of it. */
async function allCorrections(now: Date) {
  const db = getRuntimeDatabase();
  const first = await getRefCorrections(db, { limit: 1000 }, { now });
  const corrections = [...first.corrections];
  let cursor = first.next_cursor;
  while (cursor !== null) {
    const page = await getRefCorrections(db, { limit: 1000, cursor }, { now });
    corrections.push(...page.corrections);
    cursor = page.next_cursor;
  }
  return { envelope: first, corrections };
}

function Correction({ correction }: { readonly correction: RefCorrection }) {
  const written = correction.rows_written;
  return (
    <section className={styles.section} id={`c-${correction.correction_id}`}>
      <div className={styles.sectionTitle}>
        <h3 className={styles.summaryTitle}>{formatInstant(correction.published_at)}</h3>
        <span className={styles.tag}>{KIND_TEXT[correction.kind]}</span>
        <span className={styles.summaryFacts}>
          Methodology {correction.methodology_version} · {plural(written.filer_marks, "filer mark")}{" "}
          and {plural(written.certificates, "certificate")} written
        </span>
      </div>
      <p className={styles.lede}>{correction.summary}</p>
      <details className={styles.details}>
        <summary>
          <span className={styles.summaryTitle}>The diff</span>
          <span className={styles.summaryFacts}>
            correction <code>{correction.correction_id}</code>
          </span>
        </summary>
        <div className={styles.detailsBody}>
          <DocumentBody source={correction.diff_md} />
          <p className={styles.muted}>
            The rows it wrote carry its id as <code>correction_id</code> in{" "}
            <a className={styles.link} href="/data/filer-marks.csv?include=superseded">
              filer-marks.csv?include=superseded
            </a>
            ; the rows they replaced are there as superseded.
          </p>
        </div>
      </details>
    </section>
  );
}

export default async function CorrectionsPage() {
  const { envelope, corrections } = await allCorrections(new Date());
  return (
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.crumb}>Corrections</p>
        <h1>Corrections</h1>
        <Versions versions={envelope} extra={[["Computed", formatInstant(envelope.as_of)]]} />
      </header>

      <section className={styles.section} aria-labelledby="policy-head">
        <h2 id="policy-head" className={styles.sectionHead}>
          Policy
        </h2>
        <ul className={styles.list}>
          <li>
            A correction is published, never made silently. Each one says what changed, why, the
            diff, and which rows it touched, and is listed here and at{" "}
            <Link className={styles.link} href="/api/ref/corrections">
              /api/ref/corrections
            </Link>
            .
          </li>
          <li>
            A row is never edited in place. The corrected row is a new row carrying the correction's
            id; the row it replaces is superseded and stays published (
            <code>include=superseded</code> on the marks route and the CSV).
          </li>
          <li>
            Three kinds: a row (a filing read wrong), the methodology (a rule or constant changed,
            which is also a new <code>methodology_version</code>), or a parser (a reading rule
            changed). A filer's own amendment is not a correction: its marks supersede the
            original's as filed.
          </li>
          <li>
            To report one,{" "}
            <a className={styles.link} href={REPORT_URL} rel="noopener noreferrer">
              open a correction issue on GitHub
            </a>
            : name the filing's accession number (and the row's <code>mark_id</code>, on the name
            page's filings, in the marks route or the CSV) and say what the filing states. Issues
            are public: include no personal information.
          </li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="log-head">
        <div className={styles.sectionTitle}>
          <h2 id="log-head">{plural(corrections.length, "correction")}, newest first</h2>
          <span className={styles.muted}>
            {formatCount(
              corrections.reduce((sum, correction) => sum + correction.rows_written.filer_marks, 0),
            )}{" "}
            filer marks written by corrections in all
          </span>
        </div>
        {corrections.length === 0 ? (
          <p className={styles.muted}>No correction has been published.</p>
        ) : (
          corrections.map((correction) => (
            <Correction key={correction.correction_id} correction={correction} />
          ))
        )}
      </section>
    </article>
  );
}
