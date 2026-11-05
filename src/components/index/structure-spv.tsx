import type {
  NameIndex,
  SpvVehiclePayload,
  StructurePayload,
} from "../../lib/services/index/get-name-index.js";
import { formatLogChange, formatPerShare, formatValuation, plural } from "./format.js";
import styles from "./index.module.css";
import { DocumentLink } from "./name-sections.js";

function ConversionResult({ structure }: { readonly structure: StructurePayload }) {
  const result = structure.common_equivalent;
  const gap = structure.structure_gap;
  if (result.status !== "ok") {
    return (
      <p className={styles.note}>
        <span className={styles.noteHead}>Common-equivalent</span>{" "}
        {result.status === "unsupported" ? "unsupported: " : ""}
        {result.reason}. The name is published per series only (METHODOLOGY.md, Common-equivalent
        and structure gap).
      </p>
    );
  }
  return (
    <dl className={styles.figures}>
      <div className={styles.figure}>
        <dt>Common-equivalent value</dt>
        <dd className={styles.figureValue}>{formatValuation(result.commonEquivalentUsd)}</dd>
        <dd className={styles.figureNote}>
          Common's payout {formatPerShare(result.commonPerShareUsd)} a share × fully diluted shares,
          at the {formatValuation(result.headlinePostMoneyUsd)} headline (basis {result.basis})
        </dd>
      </div>
      <div className={styles.figure}>
        <dt>Structure gap</dt>
        <dd className={styles.figureValue}>
          {gap.status === "ok" ? formatLogChange(gap.gapLn) : "—"}
        </dd>
        <dd className={styles.figureNote}>
          {gap.status === "ok"
            ? `ln(headline / common-equivalent) = ${gap.gapLn.toFixed(4)}`
            : gap.reason}
        </dd>
      </div>
    </dl>
  );
}

/** The live certificate's series table and its common-equivalent result, or why there is none. */
export function Structure({ structure }: { readonly structure: StructurePayload | null }) {
  return (
    <section className={styles.section} id="structure" aria-labelledby="structure-head">
      <div className={styles.sectionTitle}>
        <h2 id="structure-head">Structure</h2>
        <span className={styles.muted}>From the Delaware certificate of incorporation</span>
      </div>
      {structure === null ? (
        <p className={styles.note}>
          <span className={styles.noteHead}>Not transcribed</span> No certificate of incorporation
          has been transcribed for this name, so there is no series table, no per-share print and no
          common-equivalent value. A certificate is bought from the Delaware registry and entered
          under data/index/certificates/ (its README gives the format).
        </p>
      ) : (
        <>
          <p className={styles.muted}>
            {structure.certificate.kind === "restated" ? "Restated certificate" : "Amendment"} filed{" "}
            {structure.certificate.filed_on},{" "}
            <DocumentLink document={structure.certificate.document}>document</DocumentLink> (SHA-256{" "}
            {structure.certificate.document.content_sha256.slice(0, 12)}…), entered by{" "}
            {structure.certificate.entered_by}.
            {structure.round === null
              ? " No priced round is linked to it."
              : ` It prices ${structure.round.round_name}.`}
          </p>
          <div className={styles.scroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Series</th>
                  <th scope="col" className={styles.num}>
                    Seniority
                  </th>
                  <th scope="col" className={styles.num}>
                    Issue price
                  </th>
                  <th scope="col" className={styles.num}>
                    Preference
                  </th>
                  <th scope="col">Participation</th>
                  <th scope="col" className={styles.num}>
                    Authorized
                  </th>
                  <th scope="col" className={styles.num}>
                    Conversion
                  </th>
                </tr>
              </thead>
              <tbody>
                {structure.certificate.series.map((series) => (
                  <tr key={series.series_label}>
                    <td>
                      {series.series_label}
                      {series.ratchet === null ? null : (
                        <span className={styles.flag}> Ratchet</span>
                      )}
                    </td>
                    <td className={styles.num}>{series.seniority}</td>
                    <td className={styles.num}>
                      {formatPerShare(series.original_issue_price_usd)}
                    </td>
                    <td className={styles.num}>{series.liquidation_multiple}×</td>
                    <td>
                      {series.participating
                        ? `Participating${series.participation_cap_multiple === null ? "" : `, cap ${series.participation_cap_multiple}×`}`
                        : "Non-participating"}
                    </td>
                    <td className={styles.num}>
                      {Number(series.shares_authorized).toLocaleString("en-US")}
                    </td>
                    <td className={styles.num}>
                      {series.conversion_price_usd === null
                        ? "1:1"
                        : formatPerShare(series.conversion_price_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {structure.certificate.unmodelled_terms.length === 0 ? null : (
            <p className={styles.muted}>
              Terms the conversion does not model:{" "}
              {structure.certificate.unmodelled_terms.join("; ")}.
            </p>
          )}
          <ConversionResult structure={structure} />
        </>
      )}
    </section>
  );
}

function money(value: string | null): string {
  return value === null ? "—" : formatValuation(value);
}

/** The newest vehicles by first sale show open; the rest fold. */
const OPEN_VEHICLES = 12;

function VehicleTable({ vehicles }: { readonly vehicles: readonly SpvVehiclePayload[] }) {
  return (
    <div className={styles.scroller}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Vehicle</th>
            <th scope="col">First sale</th>
            <th scope="col" className={styles.num}>
              Offering
            </th>
            <th scope="col" className={styles.num}>
              Sold
            </th>
            <th scope="col" className={styles.num}>
              Minimum
            </th>
            <th scope="col" className={styles.num}>
              Commission / finder
            </th>
            <th scope="col">Latest Form D</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((vehicle) => (
            <VehicleRow key={vehicle.vehicle_cik} vehicle={vehicle} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VehicleRow({ vehicle }: { readonly vehicle: SpvVehiclePayload }) {
  const filing = vehicle.latest_filing;
  return (
    <tr>
      <td className={styles.wrap}>
        {vehicle.vehicle_name}
        {vehicle.match_method === "alias" ? null : (
          <span className={styles.muted}> ({vehicle.match_method})</span>
        )}
      </td>
      <td className={styles.mono}>{filing.first_sale_on ?? "—"}</td>
      <td className={styles.num}>{money(filing.total_offering_usd)}</td>
      <td className={styles.num}>{money(filing.total_sold_usd)}</td>
      <td className={styles.num}>{money(filing.min_investment_usd)}</td>
      <td className={styles.num}>
        {money(filing.sales_commission_usd)} / {money(filing.finders_fee_usd)}
      </td>
      <td className={styles.mono}>
        <DocumentLink document={filing} />
        <span className={styles.muted}>
          {" "}
          {filing.filed_on}
          {vehicle.n_filings > 1 ? `, ${plural(vehicle.n_filings, "filing")}` : ""}
        </span>
      </td>
    </tr>
  );
}

function Quotes({ index }: { readonly index: NameIndex }) {
  return (
    <div className={styles.scroller}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Captured</th>
            <th scope="col">Platform</th>
            <th scope="col" className={styles.num}>
              Unit price
            </th>
            <th scope="col" className={styles.num}>
              Upfront fee
            </th>
            <th scope="col" className={styles.num}>
              Premium
            </th>
            <th scope="col">Page</th>
          </tr>
        </thead>
        <tbody>
          {index.spv.quotes.map((quote) => (
            <tr key={`${quote.document.document_url}${quote.captured_at}`}>
              <td className={styles.mono}>{quote.captured_at.slice(0, 10)}</td>
              <td>{quote.platform}</td>
              <td className={styles.num}>
                {quote.quoted_price_per_share_usd === null
                  ? "—"
                  : formatPerShare(quote.quoted_price_per_share_usd)}
              </td>
              <td className={styles.num}>
                {quote.upfront_fee_pct === null ? "—" : `${quote.upfront_fee_pct}%`}
              </td>
              <td className={styles.num}>
                {quote.premium.status === "ok"
                  ? `${formatLogChange(quote.premium.premiumLn ?? quote.premium.grossPremiumLn)} vs ${quote.premium.security_label} ${quote.premium.consensus_quarter}`
                  : quote.premium.reason}
              </td>
              <td>
                <DocumentLink document={quote.document}>page</DocumentLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What the SPV side can say today: vehicles found in Form D and their
 * offering facts. Unit quotes are not captured (data/index/sources-status.md,
 * "SPV unit quotes"), so no premium over consensus is published.
 */
export function SpvPanel({ index }: { readonly index: NameIndex }) {
  const { vehicles, quotes } = index.spv;
  return (
    <section className={styles.section} id="spv" aria-labelledby="spv-head">
      <div className={styles.sectionTitle}>
        <h2 id="spv-head">SPV vehicles</h2>
        <span className={styles.muted}>
          {plural(vehicles.length, "vehicle")} named for {index.issuer.name} in Form D filings
        </span>
      </div>
      {quotes.length === 0 ? (
        <p className={styles.note}>
          <span className={styles.noteHead}>No unit quotes</span> No SPV premium is published: unit
          quotes are not captured, because no page checked on 2026-11-05 quotes a price per unit of
          an SPV without a login (data/index/sources-status.md, SPV unit quotes). The panel shows
          the vehicles and what their Form D says. A vehicle's name matching the company's is how it
          was found; the filing does not say which security it holds.
        </p>
      ) : null}
      {quotes.length === 0 ? null : <Quotes index={index} />}
      {vehicles.length === 0 ? (
        <p className={styles.muted}>No Form D names a vehicle for this name.</p>
      ) : (
        <VehicleTable vehicles={vehicles.slice(0, OPEN_VEHICLES)} />
      )}
      {vehicles.length > OPEN_VEHICLES ? (
        <details className={styles.details}>
          <summary>
            <span className={styles.summaryTitle}>Earlier vehicles</span>
            <span className={styles.summaryFacts}>
              {plural(vehicles.length - OPEN_VEHICLES, "vehicle")} by first sale
            </span>
          </summary>
          <div className={styles.detailsBody}>
            <VehicleTable vehicles={vehicles.slice(OPEN_VEHICLES)} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
