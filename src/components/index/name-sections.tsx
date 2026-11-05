import type { ReactNode } from "react";

import type {
  ConsensusPayload,
  DispersionFamilyPayload,
  FamilyMarkPayload,
  LabelPayload,
  MarkDocument,
  MarkVsPrintPayload,
  NameIndex,
  OutOfSeriesGroup,
  PrintPayload,
} from "../../lib/services/index/get-name-index.js";
import {
  formatBalance,
  formatCount,
  formatDollars,
  formatLogChange,
  formatPercent,
  formatPerShare,
  formatValuation,
  labelId,
  plural,
  quarterId,
} from "./format.js";
import styles from "./index.module.css";
import { MarkChart } from "./mark-chart.js";

/** The family marks of this many latest quarters show in full; earlier ones fold. */
const OPEN_QUARTERS = 4;

function quarterOf(iso: string): string {
  return `${iso.slice(0, 4)}Q${Math.ceil(Number(iso.slice(5, 7)) / 3)}`;
}

/** A filing as a link: its accession, or "filing" when it has none. */
export function DocumentLink({
  document,
  children,
}: {
  readonly document: Pick<MarkDocument, "document_url" | "accession" | "filer_name"> & {
    readonly fund_series_name?: string | null;
  };
  readonly children?: ReactNode;
}) {
  return (
    <a className={styles.link} href={document.document_url}>
      {children ?? document.accession ?? "filing"}
    </a>
  );
}

function findFamilyMark(
  label: LabelPayload,
  family: DispersionFamilyPayload,
): FamilyMarkPayload | undefined {
  return label.family_marks.find(
    (mark) => mark.family_slug === family.family_slug && mark.as_of === family.as_of,
  );
}

/** A family's mark linked to its first filing. */
function FamilyFigure({
  label,
  family,
}: {
  readonly label: LabelPayload;
  readonly family: DispersionFamilyPayload;
}) {
  const document = findFamilyMark(label, family)?.documents[0];
  const figure = formatPerShare(family.mark_per_share_usd);
  return (
    <>
      {family.family_name}{" "}
      {document === undefined ? figure : <DocumentLink document={document}>{figure}</DocumentLink>}
    </>
  );
}

const PRINT_REASONS: Readonly<Record<string, string>> = {
  no_print_on_or_before_mark: "No priced round on or before",
  no_certificate_price: "No certificate price",
  zero_mark: "Zero mark",
};

function VersusPrint({ result }: { readonly result: MarkVsPrintPayload }) {
  if (result.status === "none") {
    return <span className={styles.muted}>{PRINT_REASONS[result.reason] ?? result.reason}</span>;
  }
  return (
    <span title={`ln ${result.ln.toFixed(4)} against ${result.round_name}`}>
      {formatLogChange(result.ln)} vs {result.round_name}{" "}
      {formatPerShare(result.price_per_share_usd)}
    </span>
  );
}

function ConsensusTable({ label }: { readonly label: LabelPayload }) {
  const rows = [...label.consensus].reverse();
  return (
    <div className={styles.scroller}>
      <table className={styles.table}>
        <caption className={styles.visuallyHidden}>
          {label.security_label}: consensus and dispersion by quarter
        </caption>
        <thead>
          <tr>
            <th scope="col">Quarter</th>
            <th scope="col" className={styles.num}>
              Consensus
            </th>
            <th scope="col" className={styles.num}>
              Families
            </th>
            <th scope="col" className={styles.num}>
              Dispersion
            </th>
            <th scope="col">High</th>
            <th scope="col">Low</th>
            <th scope="col">Versus last print</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((point) => (
            <ConsensusRow key={point.quarter} label={label} point={point} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConsensusRow({
  label,
  point,
}: {
  readonly label: LabelPayload;
  readonly point: ConsensusPayload;
}) {
  const anchor = `#${quarterId(label.security_label, point.quarter)}`;
  return (
    <tr>
      <td className={styles.mono}>{point.quarter}</td>
      <td className={styles.num}>
        <a className={`${styles.link} ${styles.price}`} href={anchor}>
          {formatPerShare(point.consensus_usd)}
        </a>
      </td>
      <td className={styles.num}>
        <a className={styles.link} href={anchor}>
          {point.n_families}
        </a>
      </td>
      <td className={styles.num}>
        {point.dispersion === null ? (
          <span className={styles.muted}>Needs 2</span>
        ) : (
          formatPercent(point.dispersion.pct)
        )}
      </td>
      <td>
        {point.dispersion === null ? null : (
          <FamilyFigure label={label} family={point.dispersion.high} />
        )}
      </td>
      <td>
        {point.dispersion === null ? null : (
          <FamilyFigure label={label} family={point.dispersion.low} />
        )}
      </td>
      <td>
        <VersusPrint result={point.mark_vs_print} />
      </td>
    </tr>
  );
}

function FamilyMarkRow({
  mark,
  used,
}: {
  readonly mark: FamilyMarkPayload;
  readonly used: boolean;
}) {
  return (
    <tr>
      <td className={styles.mono}>{mark.as_of}</td>
      <td>
        {mark.family_name}
        {mark.family_mapped ? null : (
          <span className={styles.muted} title="Not in filer-families.json: its own family">
            {" "}
            (registrant)
          </span>
        )}
      </td>
      <td className={styles.num}>{formatPerShare(mark.mark_per_share_usd)}</td>
      <td className={styles.num}>{mark.n_funds}</td>
      <td>
        {used ? (
          <span className={styles.tag}>In consensus</span>
        ) : (
          <span className={styles.muted}>Earlier in quarter</span>
        )}
        {mark.intra_family_split ? (
          <span
            className={styles.flag}
            title={`Funds range ${formatPerShare(mark.min_fund_mark_usd)} to ${formatPerShare(mark.max_fund_mark_usd)}`}
          >
            {" "}
            Split
          </span>
        ) : null}
      </td>
      <td className={styles.wrap}>
        {mark.documents[0] === undefined ? "—" : <DocumentLink document={mark.documents[0]} />}
        <span className={styles.muted}>
          {" "}
          filed {mark.documents[0]?.filed_on ?? "—"}
          {mark.documents.length > 1
            ? `; ${plural(mark.documents.length - 1, "more filing")} by its funds in the marks route`
            : ""}
        </span>
      </td>
    </tr>
  );
}

function QuarterGroup({
  label,
  quarter,
  marks,
}: {
  readonly label: LabelPayload;
  readonly quarter: string;
  readonly marks: readonly FamilyMarkPayload[];
}) {
  const point = label.consensus.find((entry) => entry.quarter === quarter);
  const used = new Set(point?.families.map((family) => `${family.family_slug}@${family.as_of}`));
  return (
    <>
      <tr className={styles.groupRow}>
        <th scope="colgroup" colSpan={6} id={quarterId(label.security_label, quarter)}>
          <strong>{quarter}</strong>
          {point === undefined
            ? null
            : ` · consensus ${formatPerShare(point.consensus_usd)} from ${plural(point.n_families, "family", "families")}`}
        </th>
      </tr>
      {marks.map((mark) => (
        <FamilyMarkRow
          key={`${mark.family_slug}${mark.as_of}`}
          mark={mark}
          used={used.has(`${mark.family_slug}@${mark.as_of}`)}
        />
      ))}
    </>
  );
}

function FamilyMarksTable({
  label,
  quarters,
}: {
  readonly label: LabelPayload;
  readonly quarters: readonly (readonly [string, readonly FamilyMarkPayload[]])[];
}) {
  return (
    <div className={styles.scroller}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">As of</th>
            <th scope="col">Family</th>
            <th scope="col" className={styles.num}>
              Mark
            </th>
            <th scope="col" className={styles.num}>
              Funds
            </th>
            <th scope="col">Used</th>
            <th scope="col">Filings</th>
          </tr>
        </thead>
        <tbody>
          {quarters.map(([quarter, marks]) => (
            <QuarterGroup key={quarter} label={label} quarter={quarter} marks={marks} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Earlier quarters, one row each: every family mark of the quarter, linked to its first filing. */
function EarlierQuarters({
  label,
  quarters,
}: {
  readonly label: LabelPayload;
  readonly quarters: readonly (readonly [string, readonly FamilyMarkPayload[]])[];
}) {
  return (
    <div className={styles.scroller}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Quarter</th>
            <th scope="col" className={styles.num}>
              Consensus
            </th>
            <th scope="col">Family marks (as of), each linking its filing</th>
          </tr>
        </thead>
        <tbody>
          {quarters.map(([quarter, marks]) => {
            const point = label.consensus.find((entry) => entry.quarter === quarter);
            return (
              <tr key={quarter} id={quarterId(label.security_label, quarter)}>
                <td className={styles.mono}>{quarter}</td>
                <td className={styles.num}>
                  {point === undefined ? "—" : formatPerShare(point.consensus_usd)}
                </td>
                <td className={styles.wrap}>
                  {marks.map((mark, index) => (
                    <span key={`${mark.family_slug}${mark.as_of}`}>
                      {index > 0 ? "; " : ""}
                      {mark.family_name}{" "}
                      {mark.documents[0] === undefined ? (
                        formatPerShare(mark.mark_per_share_usd)
                      ) : (
                        <DocumentLink document={mark.documents[0]}>
                          {formatPerShare(mark.mark_per_share_usd)}
                        </DocumentLink>
                      )}{" "}
                      ({mark.as_of.slice(5)})
                    </span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FamilyMarks({ label }: { readonly label: LabelPayload }) {
  const byQuarter = new Map<string, FamilyMarkPayload[]>();
  for (const mark of [...label.family_marks].sort(
    (a, b) => b.as_of.localeCompare(a.as_of) || a.family_name.localeCompare(b.family_name),
  )) {
    const quarter = quarterOf(mark.as_of);
    byQuarter.set(quarter, [...(byQuarter.get(quarter) ?? []), mark]);
  }
  const quarters = [...byQuarter.entries()];
  const recent = quarters.slice(0, OPEN_QUARTERS);
  const earlier = quarters.slice(OPEN_QUARTERS);
  const earlierCount = earlier.reduce((sum, [, marks]) => sum + marks.length, 0);
  return (
    <>
      <h4 className={styles.subhead}>Family marks, each with its filings</h4>
      <FamilyMarksTable label={label} quarters={recent} />
      {earlier.length === 0 ? null : (
        <details className={styles.details}>
          <summary>
            <span className={styles.summaryTitle}>Earlier quarters</span>
            <span className={styles.summaryFacts}>
              {plural(earlier.length, "quarter")}, {plural(earlierCount, "family mark")}
            </span>
          </summary>
          <div className={styles.detailsBody}>
            <EarlierQuarters label={label} quarters={earlier} />
          </div>
        </details>
      )}
    </>
  );
}

function Revisions({ label }: { readonly label: LabelPayload }) {
  if (label.revisions.length === 0) return null;
  return (
    <details className={styles.details}>
      <summary>
        <span className={styles.summaryTitle}>Revisions</span>
        <span className={styles.summaryFacts}>
          {plural(label.revisions.length, "revision")}: a family's change of at least 0.5% (ln)
          between consecutive marks
        </span>
      </summary>
      <div className={styles.detailsBody}>
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">As of</th>
                <th scope="col">Family</th>
                <th scope="col" className={styles.num}>
                  From
                </th>
                <th scope="col" className={styles.num}>
                  To
                </th>
                <th scope="col" className={styles.num}>
                  Change
                </th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {[...label.revisions].reverse().map((revision) => (
                <tr key={`${revision.family_slug}${revision.to_as_of}`}>
                  <td className={styles.mono}>{revision.to_as_of}</td>
                  <td>{revision.family_name}</td>
                  <td className={styles.num}>{formatPerShare(revision.from_mark_usd)}</td>
                  <td className={styles.num}>{formatPerShare(revision.to_mark_usd)}</td>
                  <td className={styles.num}>
                    {revision.ln === null ? "—" : formatLogChange(revision.ln)} {revision.direction}
                  </td>
                  <td>
                    {revision.role === "leader"
                      ? "Leads"
                      : `Follows ${revision.leader_family_slug} by ${revision.lag_days} days`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

function labelFacts(label: LabelPayload): string {
  const last = label.consensus.at(-1);
  if (last === undefined) return plural(label.family_marks.length, "family mark");
  return `${last.quarter}: ${formatPerShare(last.consensus_usd)}, ${plural(last.n_families, "family", "families")}${last.dispersion === null ? "" : `, dispersion ${formatPercent(last.dispersion.pct)}`}`;
}

/** One label: its chart, the consensus by quarter, and every family mark with its filings. */
export function LabelSection({
  label,
  headline,
  lastPrint,
}: {
  readonly label: LabelPayload;
  readonly headline: boolean;
  readonly lastPrint: PrintPayload | null;
}) {
  const body = (
    <>
      <MarkChart label={label} lastPrint={lastPrint} />
      <h4 className={styles.subhead}>Consensus by quarter</h4>
      <ConsensusTable label={label} />
      <FamilyMarks label={label} />
      <Revisions label={label} />
    </>
  );
  if (headline) {
    return (
      <section className={styles.section} id={labelId(label.security_label)}>
        <div className={styles.sectionTitle}>
          <h3 className={styles.summaryTitle}>{label.security_label}</h3>
          <span className={styles.tag}>Headline</span>
          <span className={styles.summaryFacts}>{labelFacts(label)}</span>
        </div>
        {body}
      </section>
    );
  }
  return (
    <details className={styles.details} id={labelId(label.security_label)}>
      <summary>
        <span className={styles.summaryTitle}>{label.security_label}</span>
        <span className={styles.summaryFacts}>{labelFacts(label)}</span>
      </summary>
      <div className={styles.detailsBody}>{body}</div>
    </details>
  );
}

const STATUS_TAGS: Readonly<Record<OutOfSeriesGroup["status"], string>> = {
  no_per_share: "No per-share mark",
  not_comparable_label: "Not compared",
  after_listing: "Listed-stock mark",
};

function OutOfSeriesTable({ group }: { readonly group: OutOfSeriesGroup }) {
  return (
    <div className={styles.scroller}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">As of</th>
            <th scope="col">Filer</th>
            <th scope="col">Title as filed</th>
            <th scope="col" className={styles.num}>
              Balance
            </th>
            <th scope="col" className={styles.num}>
              Value
            </th>
            <th scope="col" className={styles.num}>
              Per unit
            </th>
            <th scope="col">Filing</th>
          </tr>
        </thead>
        <tbody>
          {group.recent.map((mark) => (
            <tr key={mark.mark_id}>
              <td className={styles.mono}>{mark.as_of}</td>
              <td className={styles.wrap}>{mark.fund_series_name ?? mark.filer_name}</td>
              <td className={styles.wrap}>{mark.holding_title}</td>
              <td className={styles.num}>
                {mark.balance === null ? "—" : formatBalance(mark.balance)}
              </td>
              <td className={styles.num}>{formatDollars(mark.value_usd)}</td>
              <td className={styles.num}>
                {mark.mark_per_share_usd === null ? "—" : formatPerShare(mark.mark_per_share_usd)}
              </td>
              <td className={styles.mono}>
                <DocumentLink document={mark} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Live marks that enter no per-share series, as filed, with the rule that keeps each group out. */
export function OutOfSeries({ index }: { readonly index: NameIndex }) {
  const groups = index.out_of_series;
  if (groups.length === 0) return null;
  const total = groups.reduce((sum, group) => sum + group.n_marks, 0);
  return (
    <section className={styles.section} id="out-of-series" aria-labelledby="out-of-series-head">
      <div className={styles.sectionTitle}>
        <h2 id="out-of-series-head">Marks outside the series</h2>
        <span className={styles.muted}>
          {plural(total, "live mark")} published as filed and not pooled into any consensus
        </span>
      </div>
      {groups.map((group) => {
        const query = new URLSearchParams({ label: group.security_label });
        return (
          <details key={`${group.status}${group.security_label}`} className={styles.details}>
            <summary>
              <span className={styles.summaryTitle}>{group.security_label}</span>
              <span className={styles.tag}>{STATUS_TAGS[group.status]}</span>
              <span className={styles.summaryFacts}>
                {plural(group.n_marks, "mark")} from {plural(group.n_filers, "filer")}, latest as of{" "}
                {group.latest_as_of}
              </span>
            </summary>
            <div className={styles.detailsBody}>
              <p className={styles.muted}>{group.reason}</p>
              <OutOfSeriesTable group={group} />
              <p className={styles.muted}>
                {group.n_marks > group.recent.length
                  ? `The newest ${group.recent.length} of ${formatCount(group.n_marks)}. `
                  : ""}
                Every row:{" "}
                <a
                  className={styles.link}
                  href={`/api/ref/${index.issuer.slug}/marks?${query.toString()}`}
                >
                  /api/ref/{index.issuer.slug}/marks?{query.toString()}
                </a>
              </p>
            </div>
          </details>
        );
      })}
    </section>
  );
}

function PrintRow({ print }: { readonly print: PrintPayload }) {
  return (
    <tr>
      <td className={styles.mono}>{print.announced_on}</td>
      <td>{print.round_name}</td>
      <td className={styles.num}>
        {print.post_money_usd === null ? "—" : formatValuation(print.post_money_usd)}
      </td>
      <td className={styles.num}>
        {print.amount_raised_usd === null ? "—" : formatValuation(print.amount_raised_usd)}
      </td>
      <td className={styles.num}>
        {print.price_per_share_usd === null ? (
          <span className={styles.muted}>No certificate</span>
        ) : print.price_source === null ? (
          formatPerShare(print.price_per_share_usd)
        ) : (
          <DocumentLink document={print.price_source}>
            {formatPerShare(print.price_per_share_usd)}
          </DocumentLink>
        )}
      </td>
      <td className={styles.wrap}>
        {print.source_url === null ? (
          <span className={styles.muted}>{print.origin}</span>
        ) : (
          <a className={styles.link} href={print.source_url} rel="noopener noreferrer">
            {print.origin === "form_d" ? "Form D" : "Source"}
          </a>
        )}
      </td>
    </tr>
  );
}

function PrintsTable({ prints }: { readonly prints: readonly PrintPayload[] }) {
  return (
    <div className={styles.scroller}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Event</th>
            <th scope="col" className={styles.num}>
              Post-money
            </th>
            <th scope="col" className={styles.num}>
              Raised
            </th>
            <th scope="col" className={styles.num}>
              Per share
            </th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {prints.map((print) => (
            <PrintRow key={`${print.round_name}${print.announced_on}`} print={print} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Priced rounds and IPOs, newest first; the issuer's own Form D offerings fold beneath. */
export function Prints({
  prints,
  printTypes,
}: {
  readonly prints: readonly PrintPayload[];
  readonly printTypes: readonly string[];
}) {
  const priced = prints.filter((print) => printTypes.includes(print.event_type)).reverse();
  const offerings = prints.filter((print) => !printTypes.includes(print.event_type)).reverse();
  return (
    <section className={styles.section} id="prints" aria-labelledby="prints-head">
      <div className={styles.sectionTitle}>
        <h2 id="prints-head">Prints</h2>
        <span className={styles.muted}>
          Priced rounds from data/round-history/events.csv; a per-share price needs a transcribed
          certificate of incorporation.
        </span>
      </div>
      {priced.length === 0 ? (
        <p className={styles.muted}>No priced round is recorded for this name.</p>
      ) : (
        <PrintsTable prints={priced} />
      )}
      {offerings.length === 0 ? null : (
        <details className={styles.details}>
          <summary>
            <span className={styles.summaryTitle}>The issuer's own Form D offerings</span>
            <span className={styles.summaryFacts}>
              {plural(offerings.length, "offering")}: evidence of a raise's date, not a price
            </span>
          </summary>
          <div className={styles.detailsBody}>
            <PrintsTable prints={offerings} />
          </div>
        </details>
      )}
    </section>
  );
}
