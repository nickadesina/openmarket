import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import {
  formatInstant,
  formatPercent,
  formatPerShare,
  formatValuation,
  plural,
  quarterId,
} from "../../../components/index/format.js";
import styles from "../../../components/index/index.module.css";
import {
  DocumentLink,
  LabelSection,
  OutOfSeries,
  Prints,
} from "../../../components/index/name-sections.js";
import { nameShareText } from "../../../components/index/share-text.js";
import { SpvPanel, Structure } from "../../../components/index/structure-spv.js";
import { Versions } from "../../../components/index/versions.js";
import { isServiceError } from "../../../lib/api/errors.js";
import { getRuntimeDatabase } from "../../../lib/db/runtime.js";
import type {
  LabelPayload,
  MarkDocument,
  NameIndex,
} from "../../../lib/services/index/get-name-index.js";
import { PRINT_EVENT_TYPES } from "../../../lib/services/index/import-certificates.js";
import { getRefName } from "../../../lib/services/index/ref-name.js";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ slug: string }>;
}

/** One read per request, shared by the metadata and the page. */
const loadName = cache(async (slug: string): Promise<NameIndex | null> => {
  try {
    return await getRefName(getRuntimeDatabase(), slug, { now: new Date() });
  } catch (error: unknown) {
    if (isServiceError(error) && ["NAME_NOT_FOUND", "INVALID_INPUT"].includes(error.code)) {
      return null;
    }
    throw error;
  }
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const index = await loadName((await params).slug);
  if (index === null) return { title: "Name not found" };
  const share = nameShareText(index);
  return {
    title: index.issuer.name,
    description: share.description,
    robots: { index: false, follow: false },
    openGraph: { title: share.title, description: share.description, type: "article" },
    twitter: { card: "summary", title: share.title, description: share.description },
  };
}

/** Headline first, then the labels with the most families in their latest quarter. */
function orderLabels(index: NameIndex): LabelPayload[] {
  const families = (label: LabelPayload) => label.consensus.at(-1)?.n_families ?? 0;
  return [...index.labels].sort(
    (a, b) =>
      Number(b.security_label === index.headline?.security_label) -
        Number(a.security_label === index.headline?.security_label) ||
      families(b) - families(a) ||
      b.family_marks.length - a.family_marks.length ||
      a.security_label.localeCompare(b.security_label),
  );
}

/** A document filed on the name's latest filing date, to link that date to. */
function latestDocument(index: NameIndex): MarkDocument | undefined {
  const filed = index.marks_summary.latest_filed_on;
  if (filed === null) return undefined;
  for (const label of index.labels) {
    for (const mark of label.family_marks) {
      const document = mark.documents.find((entry) => entry.filed_on === filed);
      if (document !== undefined) return document;
    }
  }
  for (const group of index.out_of_series) {
    const document = group.recent.find((entry) => entry.filed_on === filed);
    if (document !== undefined) return document;
  }
  return undefined;
}

function HeadlineFigures({ index }: { readonly index: NameIndex }) {
  const headline = index.headline;
  const label = index.labels.find((entry) => entry.security_label === headline?.security_label);
  const point = label?.consensus.find((entry) => entry.quarter === headline?.quarter);
  const anchor =
    headline === null ? "#filer-marks" : `#${quarterId(headline.security_label, headline.quarter)}`;
  const latest = latestDocument(index);
  const print = index.last_print;
  const familyLink = (family: NonNullable<typeof point>["families"][number]) => {
    const document = label?.family_marks.find(
      (mark) => mark.family_slug === family.family_slug && mark.as_of === family.as_of,
    )?.documents[0];
    const figure = formatPerShare(family.mark_per_share_usd);
    return document === undefined ? (
      figure
    ) : (
      <DocumentLink document={document}>{figure}</DocumentLink>
    );
  };
  return (
    <dl className={styles.figures}>
      <div className={styles.figure}>
        <dt>Consensus</dt>
        <dd className={`${styles.figureValue} ${styles.price}`}>
          {headline === null ? "—" : <a href={anchor}>{formatPerShare(headline.consensus_usd)}</a>}
        </dd>
        <dd className={styles.figureNote}>
          {headline === null
            ? "No per-share series"
            : `${headline.security_label}, ${headline.quarter}: median of family marks`}
        </dd>
      </div>
      <div className={styles.figure}>
        <dt>Dispersion</dt>
        <dd className={styles.figureValue}>
          {point?.dispersion == null ? (
            "—"
          ) : (
            <a href={anchor}>{formatPercent(point.dispersion.pct)}</a>
          )}
        </dd>
        <dd className={styles.figureNote}>
          {point?.dispersion == null ? (
            "Needs two families"
          ) : (
            <>
              High {point.dispersion.high.family_name} {familyLink(point.dispersion.high)}; low{" "}
              {point.dispersion.low.family_name} {familyLink(point.dispersion.low)}
            </>
          )}
        </dd>
      </div>
      <div className={styles.figure}>
        <dt>Families</dt>
        <dd className={styles.figureValue}>
          {headline === null ? "—" : <a href={anchor}>{headline.n_families}</a>}
        </dd>
        <dd className={styles.figureNote}>
          {plural(index.marks_summary.live, "live mark")},{" "}
          {plural(index.marks_summary.in_series, "in a series", "in a series")}
        </dd>
      </div>
      <div className={styles.figure}>
        <dt>Latest filing</dt>
        <dd className={styles.figureValue}>
          {latest === undefined ? (
            (index.marks_summary.latest_filed_on ?? "—")
          ) : (
            <DocumentLink document={latest}>{index.marks_summary.latest_filed_on}</DocumentLink>
          )}
        </dd>
        <dd className={styles.figureNote}>
          {index.marks_summary.latest_as_of === null
            ? "No filer mark"
            : `Marks as of ${index.marks_summary.latest_as_of}`}
        </dd>
      </div>
      <div className={styles.figure}>
        <dt>Last print</dt>
        <dd className={styles.figureValue}>
          {print === null || print.post_money_usd === null ? (
            "—"
          ) : print.source_url === null ? (
            formatValuation(print.post_money_usd)
          ) : (
            <a href={print.source_url} rel="noopener noreferrer">
              {formatValuation(print.post_money_usd)}
            </a>
          )}
        </dd>
        <dd className={styles.figureNote}>
          {print === null
            ? "No priced round recorded"
            : `${print.round_name}, ${print.announced_on}${print.price_per_share_usd === null ? "; no per-share price" : `; ${formatPerShare(print.price_per_share_usd)} a share`}`}
        </dd>
      </div>
    </dl>
  );
}

function NoMarksNote({ index }: { readonly index: NameIndex }) {
  const noMarks = index.no_marks;
  if (noMarks === null) return null;
  return (
    <div className={styles.note}>
      <p>
        <span className={styles.noteHead}>No filer marks</span> {noMarks.reason}
      </p>
      {noMarks.filings.length === 0 ? null : (
        <ul>
          {noMarks.filings.map((filing) => (
            <li key={filing.accession}>
              {filing.filer_name}, filed {filing.filed_on ?? "—"}:{" "}
              <DocumentLink document={{ ...filing, document_url: filing.url }} />
              {filing.read ? " (read; no matching holding)" : " (not read)"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ListedNote({ index }: { readonly index: NameIndex }) {
  const listed = index.issuer.listed_on;
  if (listed === null) return null;
  return (
    <p className={styles.note}>
      <span className={styles.noteHead}>Listed</span> {index.issuer.name}'s final IPO prospectus was
      filed on {listed}
      {index.issuer.listing_url === null ? null : (
        <>
          {" "}
          (
          <a className={styles.link} href={index.issuer.listing_url} rel="noopener noreferrer">
            424B4
          </a>
          )
        </>
      )}
      . Marks as of that date or later are set from the market, not by a valuation committee: they
      are published below as filed and enter no series (METHODOLOGY.md, Listed names).
    </p>
  );
}

export default async function NamePage({ params }: PageProps) {
  const index = await loadName((await params).slug);
  if (index === null) notFound();
  const slug = index.issuer.slug;
  const labels = orderLabels(index);
  const legal = [
    index.issuer.legal_name,
    index.issuer.incorporation_state === null
      ? null
      : `incorporated in ${index.issuer.incorporation_state}`,
  ].filter((part) => part !== null);

  return (
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.crumb}>
          <Link href="/">Marks index</Link>
        </p>
        <h1>{index.issuer.name}</h1>
        {legal.length === 0 ? null : (
          <p className={styles.muted}>
            {legal.join(", ")}
            {index.issuer.incorporation_source === null ? null : (
              <>
                {" "}
                (<DocumentLink document={index.issuer.incorporation_source}>Form D</DocumentLink>)
              </>
            )}
          </p>
        )}
      </header>

      <HeadlineFigures index={index} />
      <p className={styles.muted}>{index.lag_note}</p>
      <ListedNote index={index} />
      <NoMarksNote index={index} />

      <section className={styles.section} id="filer-marks" aria-labelledby="labels-head">
        <div className={styles.sectionTitle}>
          <h2 id="labels-head">Marks by security</h2>
          <span className={styles.muted}>
            {labels.length === 0
              ? "No label has a per-share series."
              : `${plural(labels.length, "label")} with a per-share series; marks on different labels are never pooled`}
          </span>
        </div>
        {labels.map((label) => (
          <LabelSection
            key={label.security_label}
            label={label}
            headline={label.security_label === index.headline?.security_label}
            lastPrint={index.last_print}
          />
        ))}
      </section>

      <OutOfSeries index={index} />
      <Prints prints={index.prints} printTypes={PRINT_EVENT_TYPES} />
      <Structure structure={index.structure} />
      <SpvPanel index={index} />

      <section className={styles.section} aria-labelledby="data-head">
        <h2 id="data-head" className={styles.sectionHead}>
          Data
        </h2>
        <ul className={styles.links}>
          <li>
            <a className={styles.link} href={`/data/filer-marks.csv?issuer=${slug}`}>
              filer-marks-{slug}.csv
            </a>
          </li>
          <li>
            <a className={styles.link} href={`/data/spv-matches.csv?issuer=${slug}`}>
              spv-matches-{slug}.csv
            </a>
          </li>
          <li>
            <a className={styles.link} href={`/api/ref/${slug}`}>
              /api/ref/{slug}
            </a>
          </li>
          <li>
            <a className={styles.link} href={`/api/ref/${slug}/marks`}>
              /api/ref/{slug}/marks
            </a>
          </li>
        </ul>
        <Versions
          versions={index}
          extra={[
            ["Families", index.families_version],
            ["Computed", formatInstant(index.as_of)],
          ]}
        />
      </section>
    </article>
  );
}
