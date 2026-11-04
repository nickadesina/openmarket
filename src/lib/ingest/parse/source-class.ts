/**
 * The mark side's source classes (`source_documents.source_class`) and their
 * default ranks, 1 the most authoritative, in the order the v2 brief gives
 * (docs/prompts/v2/README.md, "Data model").
 *
 * Interim: this table is replaced by the rulebook's `sourceRank(sourceClass)`
 * (src/lib/engine/rulebook.ts, P6) when the parts merge; ingest then stores
 * the rank the rulebook gives. The ranks here are the brief's order, not a
 * published rule.
 */

export const SOURCE_CLASSES = [
  "ncsr",
  "nport",
  "fund_holdings_page",
  "closed_end_nav",
  "delaware_coi",
  "form_d",
  "spv_quote_page",
  "company_statement",
  "press",
] as const;

export type SourceClass = (typeof SOURCE_CLASSES)[number];

export const DEFAULT_SOURCE_RANK: Readonly<Record<SourceClass, number>> = Object.freeze(
  Object.fromEntries(
    SOURCE_CLASSES.map((sourceClass, index) => [sourceClass, index + 1]),
  ) as Record<SourceClass, number>,
);

export function defaultSourceRank(sourceClass: SourceClass): number {
  return DEFAULT_SOURCE_RANK[sourceClass];
}

export function isSourceClass(value: string): value is SourceClass {
  return (SOURCE_CLASSES as readonly string[]).includes(value);
}
