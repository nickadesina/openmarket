import { z } from "zod";

import data from "../../../docs/tradeables/resolution-sources.json";
import { RULEBOOK } from "../engine/rulebook.js";

/**
 * The resolution-source map (docs/prompts/tradeables, item 1): how each venue
 * that prices private companies settles, from
 * docs/tradeables/resolution-sources.json, and OpenMarket's own row computed
 * from RULEBOOK so the map can never disagree with the code. The page at
 * /resolution-sources, the markdown at /resolution-sources.md and
 * scripts/export-resolution-sources.ts all render from here.
 */

const OPENMARKET = "OpenMarket";
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const url = z.url({ protocol: /^https$/ });

/** One venue row. The field set is fixed by the brief; nulls stay null. */
export const resolutionSourceRowSchema = z
  .strictObject({
    venue: z.string().min(1),
    product: z.string().min(1),
    /** A year, a month or a day: the precision the source gives. */
    launched: z
      .string()
      .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
      .nullable(),
    instrument: z.string().min(1),
    settlement_source: z.string().min(1),
    source_published: z.boolean(),
    revision_window: z.string().min(1).nullable(),
    void_rule: z.string().min(1).nullable(),
    status: z.string().min(1),
    notes: z.string().min(1),
    sources: z.array(url),
    verified: isoDate.nullable(),
    needs_check: z.boolean(),
  })
  .refine((row) => row.needs_check || row.sources.length > 0, {
    message: "a confirmed row (needs_check: false) needs a source URL",
    path: ["sources"],
  })
  .refine((row) => row.needs_check || row.verified !== null, {
    message: "a confirmed row (needs_check: false) needs a verification date",
    path: ["verified"],
  });

export const resolutionSourcesFileSchema = z.strictObject({
  as_of: isoDate,
  schema: z.string().min(1),
  rows: z
    .array(resolutionSourceRowSchema)
    .min(1)
    .refine((rows) => rows.every((row) => row.venue !== OPENMARKET), {
      message: "OpenMarket's row is computed from the rulebook, never typed into the file",
    }),
  context: z.array(
    z.strictObject({
      item: z.string().min(1),
      summary: z.string().min(1),
      sources: z.array(url).min(1),
    }),
  ),
});

export type ResolutionSourceRow = z.infer<typeof resolutionSourceRowSchema>;
export type ResolutionSourcesFile = z.infer<typeof resolutionSourcesFileSchema>;

export const SITE_ORIGIN = "https://openmarket.systems";
export const RULEBOOK_PATH = "/api/ref/rulebook";
export const MARKDOWN_PATH = "/resolution-sources.md";
export const LICENSE = "CC BY 4.0, cite OpenMarket";

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** OpenMarket's row: every rule-bearing field is read from RULEBOOK. */
export function openMarketRow(asOf: string): ResolutionSourceRow {
  const ranks = RULEBOOK.source_ranks.map(({ rank, source }) => `${rank} ${source}`).join("; ");
  const kinds = (["binary", "forward"] as const).filter((kind) => kind in RULEBOOK);
  return {
    venue: OPENMARKET,
    product:
      "Quarterly timing binary (a priced round by quarter-end; a public S-1 for the labs) and a cash-settled forward on the next post-money, as the rulebook specifies them; OpenMarket quotes neither",
    launched: null,
    instrument: kinds.join(" and "),
    settlement_source: `${RULEBOOK.print.definition} For the labs, also ${lowerFirst(RULEBOOK.print.also_for_labs)} Ranked sources: ${ranks}. Tier-1 outlets: ${RULEBOOK.tier1_outlets.join(", ")}.`,
    source_published: true,
    revision_window: `${RULEBOOK.revision_window_days} days for a higher-ranked source, plus ${RULEBOOK.observation_grace_days} day of observation grace after the deadline`,
    void_rule: RULEBOOK.forward.void,
    status: "rulebook published; no market live (the v1 paper markets are archived)",
    notes: `The rulebook is code, versioned (v${RULEBOOK.version}), and published as JSON at ${RULEBOOK_PATH}.`,
    sources: [`${SITE_ORIGIN}${RULEBOOK_PATH}`],
    verified: asOf,
    needs_check: false,
  };
}

/** The committed file, validated, with OpenMarket's computed row last. */
export function resolutionSources(): {
  readonly file: ResolutionSourcesFile;
  readonly rows: readonly ResolutionSourceRow[];
} {
  const file = resolutionSourcesFileSchema.parse(data);
  return { file, rows: [...file.rows, openMarketRow(file.as_of)] };
}

/** How a null renders: absence, never a guess. */
export const UNKNOWN = "Unknown";

export function publishedLabel(row: ResolutionSourceRow): string {
  return row.source_published ? "yes" : "no";
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/**
 * The map as Markdown, readable top to bottom in a text editor: a short
 * header, one table with the page's columns, a note per venue, the context
 * items and a numbered, de-duplicated source list.
 */
export function renderResolutionSourcesMarkdown(): string {
  const { file, rows } = resolutionSources();
  const lines: string[] = [
    "# How private-company valuation venues settle",
    "",
    `As of ${file.as_of}. One row per venue or product that prices a private company's valuation. OpenMarket's row is computed from its rulebook (v${RULEBOOK.version}, ${SITE_ORIGIN}${RULEBOOK_PATH}). Rows marked unverified have not been confirmed against a primary source. "${UNKNOWN}" marks a field the research did not establish.`,
    "",
    `License: ${LICENSE}.`,
    "",
    "| Venue | Product | Instrument | Settles on | Rule published | Revision window | Void rule | Status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const venue = row.needs_check ? `${row.venue} (unverified)` : row.venue;
    lines.push(
      `| ${[
        venue,
        row.product,
        row.instrument,
        row.settlement_source,
        publishedLabel(row),
        row.revision_window ?? UNKNOWN,
        row.void_rule ?? UNKNOWN,
        row.status,
      ]
        .map(cell)
        .join(" | ")} |`,
    );
  }
  lines.push("", "## Notes", "");
  for (const row of rows) {
    const launched = row.launched === null ? "" : ` Launched ${row.launched}.`;
    const verified = row.verified === null ? "" : ` Sources read ${row.verified}.`;
    lines.push(`**${row.venue}.** ${row.notes}${launched}${verified}`, "");
  }
  lines.push("## Context", "");
  for (const item of file.context) lines.push(`**${item.item}.** ${item.summary}`, "");
  lines.push("## Sources", "");
  const sources = [...new Set([...rows, ...file.context].flatMap((entry) => entry.sources))];
  for (const [index, source] of sources.entries()) lines.push(`${index + 1}. ${source}`);
  return `${lines.join("\n")}\n`;
}
