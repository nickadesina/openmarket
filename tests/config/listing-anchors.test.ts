import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEALER_PARAMS } from "../../src/lib/config/dealer.js";
import {
  EVENTS_CSV_PATH,
  listingAnchors,
  parseCsv,
  parseSources,
} from "../../src/lib/config/listing-anchors.js";

/**
 * A listing's anchor is the name's last priced round in events.csv, joined on
 * (company, round_name, announcement_date) to its best-ranked source. The
 * fixture's URLs are example.test placeholders.
 */
const EVENTS = readFileSync(EVENTS_CSV_PATH, "utf8");
const SOURCES = readFileSync("tests/fixtures/listing-sources.csv", "utf8");
const NAMES = Object.keys(DEALER_PARAMS.forward_t_days);
const HEADER =
  "company,round_name,announcement_date,source_url,source_title,publisher,source_rank,published_date,verified_at";

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes, CRLF and a trailing newline", () => {
    expect(parseCsv('a,b\r\n"x, ""y""",2\r\n\r\n')).toEqual([{ a: 'x, "y"', b: "2" }]);
  });

  it("rejects a row whose width differs from the header", () => {
    expect(() => parseCsv("a,b\n1,2,3\n")).toThrow(/3 fields/);
  });
});

describe("listingAnchors", () => {
  it("anchors each launch name on its last priced round", () => {
    const anchors = listingAnchors(EVENTS, SOURCES, NAMES);
    expect(
      anchors.map((anchor) => [
        anchor.company,
        anchor.roundName,
        anchor.announcementDate,
        anchor.postMoneyUsd,
      ]),
    ).toEqual([
      ["Anduril", "Series H", "2026-05-13", "61000000000"],
      ["Anthropic", "Series H", "2026-05-28", "965000000000"],
      ["Instinct", "Series C", "2026-09-28", "10000000000"],
      ["Modal", "Series D", "2026-10-14", "15750000000"],
      ["OpenAI", "2026 mega-round (final close)", "2026-03-31", "852000000000"],
    ]);
  });

  it("joins the best-ranked source for the anchor round, not an earlier round's", () => {
    const byCompany = new Map(
      listingAnchors(EVENTS, SOURCES, NAMES).map((anchor) => [anchor.company, anchor.source]),
    );
    expect(byCompany.get("Anthropic")).toEqual({
      url: "https://example.test/anthropic-release",
      rank: 1,
    });
    expect(byCompany.get("Modal")).toEqual({ url: "https://example.test/modal-filing", rank: 2 });
    expect(byCompany.get("Instinct")).toEqual({
      url: "https://example.test/instinct-release",
      rank: null,
    });
  });

  it("returns a null source when the file or the row is missing", () => {
    expect(listingAnchors(EVENTS, null, NAMES).every((anchor) => anchor.source === null)).toBe(
      true,
    );
    const blankUrl = `${HEADER}\nModal,Series D,2026-10-14,,t,p,1,2026-10-14,2026-10-21T00:00:00Z\n`;
    expect(listingAnchors(EVENTS, blankUrl, ["Modal"])[0]!.source).toBeNull();
  });

  it("refuses a company with no priced round", () => {
    expect(() => listingAnchors(EVENTS, SOURCES, ["Unlisted Labs"])).toThrow(/no priced_round/);
  });
});

describe("parseSources", () => {
  it("refuses a malformed sources file", () => {
    expect(() => parseSources("company,source_url\nModal,https://example.test/x\n")).toThrow(
      /missing columns/,
    );
    expect(() =>
      parseSources(`${HEADER}\nModal,Series D,2026-10-14,http://example.test,t,p,1,,\n`),
    ).toThrow(/must be https/);
    expect(() =>
      parseSources(`${HEADER}\nModal,Series D,2026-10-14,https://example.test,t,p,5,,\n`),
    ).toThrow(/source_rank must be 1–4/);
  });
});
