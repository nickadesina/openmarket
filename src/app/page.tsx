import type { Metadata } from "next";
import Link from "next/link";

import {
  formatInstant,
  formatPercent,
  formatPerShare,
  formatValuation,
  plural,
  quarterId,
} from "../components/index/format.js";
import shared from "../components/index/index.module.css";
import { Versions } from "../components/index/versions.js";
import { getRuntimeDatabase } from "../lib/db/runtime.js";
import type { NameRow } from "../lib/services/index/list-names.js";
import { getRefNames } from "../lib/services/index/ref-names.js";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "OpenMarket: private-company marks from public filings" },
  description:
    "Every watchlist name's consensus mark across filer families, and how far the families disagree, from N-PORT filings. Every figure links to its filing.",
  robots: { index: false, follow: false },
};

/** Names with a headline first, by dispersion (highest first), then by families. */
function order(a: NameRow, b: NameRow): number {
  return (
    (b.dispersion_pct ?? -1) - (a.dispersion_pct ?? -1) ||
    (b.n_families ?? 0) - (a.n_families ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

function LastPrint({ print }: { readonly print: NameRow["last_print"] }) {
  if (print === null) return <span className={shared.muted}>None recorded</span>;
  const text = `${print.round_name}${print.post_money_usd === null ? "" : `, ${formatValuation(print.post_money_usd)}`}`;
  return (
    <>
      {print.source_url === null ? (
        text
      ) : (
        <a className={shared.link} href={print.source_url} rel="noopener noreferrer">
          {text}
        </a>
      )}
      <span className={styles.sub}>{print.announced_on}</span>
    </>
  );
}

function IndexedRow({ row }: { readonly row: NameRow }) {
  const anchor = `/n/${row.slug}#${quarterId(row.security_label!, row.quarter!)}`;
  return (
    <tr>
      <th scope="row" data-label="Name">
        <div>
          <Link className={styles.name} href={`/n/${row.slug}`}>
            {row.name}
          </Link>
          {row.listed_on === null ? null : (
            <span className={styles.sub}>
              Listed {row.listed_on}
              {row.listing_url === null ? null : (
                <>
                  {" "}
                  (
                  <a className={shared.link} href={row.listing_url} rel="noopener noreferrer">
                    424B4
                  </a>
                  )
                </>
              )}
            </span>
          )}
        </div>
      </th>
      <td data-label="Security">
        <div>
          {row.security_label}
          <span className={styles.sub}>{row.quarter}</span>
        </div>
      </td>
      <td className={shared.num} data-label="Consensus">
        <div>
          <Link className={`${shared.link} ${shared.price}`} href={anchor}>
            {formatPerShare(row.consensus_usd!)}
          </Link>
        </div>
      </td>
      <td className={shared.num} data-label="Dispersion">
        <div>
          {row.dispersion_pct === null ? (
            <span className={styles.none}>One family</span>
          ) : (
            <Link className={shared.link} href={anchor}>
              {formatPercent(row.dispersion_pct)}
            </Link>
          )}
        </div>
      </td>
      <td className={shared.num} data-label="Families">
        <div>
          <Link className={shared.link} href={anchor}>
            {row.n_families}
          </Link>
        </div>
      </td>
      <td className={shared.mono} data-label="Latest filing">
        <div>
          <Link className={shared.link} href={`/n/${row.slug}#filer-marks`}>
            {row.latest_filed_on}
          </Link>
          <span className={styles.sub}>as of {row.latest_as_of}</span>
        </div>
      </td>
      <td data-label="Last print">
        <div>
          <LastPrint print={row.last_print} />
        </div>
      </td>
    </tr>
  );
}

function UnindexedRow({ row }: { readonly row: NameRow }) {
  let why: string;
  if (row.no_marks !== null) why = row.no_marks.reason;
  else
    why = `${plural(row.live_marks, "live mark")}, none of them in a per-share series: see the name page for each mark as filed and the rule that keeps it out.`;
  return (
    <tr>
      <th scope="row" data-label="Name">
        <div>
          <Link className={styles.name} href={`/n/${row.slug}`}>
            {row.name}
          </Link>
        </div>
      </th>
      <td data-label="Why" className={styles.why}>
        <div>
          <span className={styles.tagline}>
            {row.no_marks === null ? "No per-share series" : "No filer marks"}
          </span>
          {why}
        </div>
      </td>
      <td data-label="Last print">
        <div>
          <LastPrint print={row.last_print} />
        </div>
      </td>
      <td className={shared.num} data-label="SPV vehicles">
        <div>
          {row.spv_vehicles === 0 ? (
            <span className={styles.none}>None</span>
          ) : (
            <Link className={shared.link} href={`/n/${row.slug}#spv`}>
              {row.spv_vehicles}
            </Link>
          )}
        </div>
      </td>
    </tr>
  );
}

export default async function IndexPage() {
  const payload = await getRefNames(getRuntimeDatabase(), { now: new Date() });
  const indexed = payload.names.filter((row) => row.consensus_usd !== null).sort(order);
  const unindexed = payload.names
    .filter((row) => row.consensus_usd === null)
    .sort((a, b) => b.live_marks - a.live_marks || a.name.localeCompare(b.name));
  const latestFiling = indexed.reduce<string | null>(
    (latest, row) =>
      row.latest_filed_on !== null && (latest === null || row.latest_filed_on > latest)
        ? row.latest_filed_on
        : latest,
    null,
  );

  return (
    <article className={shared.page}>
      <header className={shared.pageHeader}>
        <p className={shared.crumb}>Marks index</p>
        <h1>Private-company marks from public filings</h1>
        <p className={shared.lede}>
          What registered funds say each private company's shares are worth, filing by filing: the
          consensus mark (the median across filer families) on each name's most-held security, and
          the dispersion between the highest and lowest family. Every figure links to the filing it
          came from.
        </p>
        <p className={shared.muted}>{payload.lag_note}</p>
        <Versions
          versions={payload}
          extra={[
            ["Families", payload.families_version],
            ["Computed", formatInstant(payload.as_of)],
          ]}
        />
      </header>

      <section className={shared.section} aria-labelledby="indexed-head">
        <div className={shared.sectionTitle}>
          <h2 id="indexed-head">{plural(indexed.length, "name")} with a consensus</h2>
          <span className={shared.muted}>
            {latestFiling === null ? null : `Latest filing ${latestFiling}. `}
            Highest dispersion first.
          </span>
        </div>
        <div className={shared.scroller}>
          <table className={`${shared.table} ${styles.board}`}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Security · quarter</th>
                <th scope="col" className={shared.num}>
                  Consensus
                </th>
                <th scope="col" className={shared.num}>
                  Dispersion
                </th>
                <th scope="col" className={shared.num}>
                  Families
                </th>
                <th scope="col">Latest filing</th>
                <th scope="col">Last print</th>
              </tr>
            </thead>
            <tbody>
              {indexed.map((row) => (
                <IndexedRow key={row.slug} row={row} />
              ))}
            </tbody>
          </table>
        </div>
        <p className={shared.muted}>
          Security: the label with the most families in the latest quarter that has a consensus
          (METHODOLOGY.md, Headline label); each name page shows every label. Dispersion is (high −
          low) / median of the family marks, published from two families. A family is the funds
          under one adviser, which mark a security alike.
        </p>
      </section>

      {unindexed.length === 0 ? null : (
        <section className={shared.section} aria-labelledby="unindexed-head">
          <div className={shared.sectionTitle}>
            <h2 id="unindexed-head">{plural(unindexed.length, "name")} with no consensus</h2>
          </div>
          <div className={shared.scroller}>
            <table className={`${shared.table} ${styles.board}`}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Why</th>
                  <th scope="col">Last print</th>
                  <th scope="col" className={shared.num}>
                    SPV vehicles
                  </th>
                </tr>
              </thead>
              <tbody>
                {unindexed.map((row) => (
                  <UnindexedRow key={row.slug} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={shared.section} aria-labelledby="data-head">
        <h2 id="data-head" className={shared.sectionHead}>
          Data
        </h2>
        <ul className={shared.links}>
          <li>
            <a className={shared.link} href="/data/filer-marks.csv">
              filer-marks.csv
            </a>{" "}
            <span className={shared.muted}>every live mark, with its accession and URL</span>
          </li>
          <li>
            <Link className={shared.link} href="/ref">
              Reference API
            </Link>
          </li>
          <li>
            <Link className={shared.link} href="/methodology">
              Methodology
            </Link>
          </li>
          <li>
            <Link className={shared.link} href="/corrections">
              Corrections
            </Link>
          </li>
        </ul>
        <p className={shared.muted}>
          CC BY 4.0. Nothing here is a quote, a forecast or a view on where a name should trade: the
          figures are the filers' marks and the arithmetic on them.
        </p>
      </section>
    </article>
  );
}
