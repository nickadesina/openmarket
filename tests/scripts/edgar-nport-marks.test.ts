import { describe, expect, it } from "vitest";

import { matchingHoldings, tagText } from "../../scripts/research/edgar-nport-marks.js";

/** The N-PORT form's shape (edgarSubmission → formData → invstOrSecs), with made-up figures. */
const NPORT = `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/nport">
  <formData>
    <genInfo><regName>Example Trust</regName><seriesName>Example Growth Fund</seriesName><seriesId>S000000001</seriesId><repPdDate>2026-06-30</repPdDate></genInfo>
    <invstOrSecs>
      <invstOrSec>
        <name>Anthropic PBC</name><title>Anthropic PBC Series F Preferred</title>
        <balance>1000.00</balance><units>NS</units><valUSD>250000.00</valUSD><pctVal>0.12</pctVal>
        <assetCat>EP</assetCat><fairValLevel>3</fairValLevel><isRestrictedSec>Y</isRestrictedSec>
      </invstOrSec>
      <invstOrSec>
        <name>Example Public Co &amp; Sons</name><title>Common</title>
        <balance>10</balance><units>NS</units><valUSD>500</valUSD><pctVal>0.01</pctVal>
      </invstOrSec>
      <invstOrSec>
        <name>Private SPV LLC</name><title>Interest in Anthropic</title>
        <balance>0</balance><units>OU</units><valUSD>75000</valUSD><pctVal>0.03</pctVal>
        <assetConditional assetCat="OTHER" description="SPV"/>
      </invstOrSec>
    </invstOrSecs>
  </formData>
</edgarSubmission>`;

describe("N-PORT parsing", () => {
  it("reads the fund and report period", () => {
    expect(tagText(NPORT, "regName")).toBe("Example Trust");
    expect(tagText(NPORT, "seriesName")).toBe("Example Growth Fund");
    expect(tagText(NPORT, "repPdDate")).toBe("2026-06-30");
    expect(tagText(NPORT, "missing")).toBe("");
  });

  it("keeps holdings whose name or title names the company, with value and shares", () => {
    const found = matchingHoldings(NPORT, /\bAnthropic\b/i);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({
      holding_name: "Anthropic PBC",
      balance: "1000.00",
      units: "NS",
      value_usd: "250000.00",
      pct_of_net_assets: "0.12",
      asset_category: "EP",
      fair_value_level: "3",
      restricted: "Y",
      value_per_unit_usd: "250",
    });
    expect(found[1]).toMatchObject({
      holding_title: "Interest in Anthropic",
      asset_category: "OTHER",
      value_per_unit_usd: "",
    });
  });

  it("decodes entities and ignores other holdings", () => {
    expect(matchingHoldings(NPORT, /Sons/)[0]?.holding_name).toBe("Example Public Co & Sons");
    expect(matchingHoldings(NPORT, /\bOpenAI\b/)).toEqual([]);
  });
});
