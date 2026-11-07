import type { NameIndex } from "../../lib/services/index/get-name-index.js";
import { formatPercent, formatPerShare, plural } from "./format.js";

/** The Open Graph text a post links to: the name, the dispersion figure, the filing date. */
export function nameShareText(index: NameIndex): { title: string; description: string } {
  const name = index.issuer.name;
  const headline = index.headline;
  const filed = index.marks_summary.latest_filed_on;
  if (headline === null) {
    return {
      title: `${name}: no consensus mark`,
      description: `${
        index.no_headline?.reason ??
        `${plural(index.marks_summary.live, "live filer mark")}, none in a per-share series.`
      }${filed === null ? "" : ` Latest filing ${filed}.`}`,
    };
  }
  const families = plural(headline.n_families, "filer family", "filer families");
  const title =
    headline.dispersion_pct === null
      ? `${name}: consensus ${formatPerShare(headline.consensus_usd)} across ${families}`
      : `${name}: ${formatPercent(headline.dispersion_pct)} dispersion across ${families}`;
  return {
    title,
    description: `${headline.security_label}, as of ${headline.as_of}: consensus ${formatPerShare(headline.consensus_usd)}, the median of ${families}' marks. Latest filing ${filed}. From public N-PORT filings, each mark linked to its filing; methodology ${index.methodology_version}.`,
  };
}
