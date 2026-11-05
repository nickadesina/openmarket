/**
 * `data/index/filer-families.json` as ingest reads it. The shape and its
 * validation are the engine's (`parseFilerFamilies` in
 * src/lib/engine/index/families.ts); this file adds only what ingest needs
 * on top: parsing the file's text, and a CIK → family slug lookup for the
 * search output. A CIK in no family is its own family, `cik-<CIK>`.
 */
import {
  type FilerFamilies,
  type FilerFamily,
  normalizeCik,
  parseFilerFamilies,
} from "../../engine/index/families.js";

export type { FilerFamilies, FilerFamily };

/** The file's text, validated by the engine's schema. */
export function parseFilerFamiliesText(text: string): FilerFamilies {
  return parseFilerFamilies(JSON.parse(text) as unknown);
}

/** CIK (padded or not) → family slug; a CIK in no family maps to `cik-<CIK>`. */
export function familyLookup(families: FilerFamilies): (cik: string) => string {
  const byCik = new Map<string, string>();
  for (const family of families.families) {
    for (const cik of family.ciks) byCik.set(normalizeCik(cik), family.slug);
  }
  return (cik) => {
    const normalized = normalizeCik(cik);
    return byCik.get(normalized) ?? `cik-${normalized}`;
  };
}
