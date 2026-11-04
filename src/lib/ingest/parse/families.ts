/**
 * `data/index/filer-families.json`: which registrants share an adviser, and
 * so a valuation committee (docs/prompts/v2/README.md, "Filer family"). The
 * engine compares families, not funds; ingest only names each filing's
 * family in the search output. A CIK in no family is its own family.
 */
import { z } from "zod";

const familySchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1),
    ciks: z.array(z.string().regex(/^[1-9]\d*$/)).min(1),
    evidence: z.string().trim().min(1),
  })
  .strict();

const familiesSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    note: z.string().optional(),
    families: z.array(familySchema),
  })
  .strict()
  .superRefine((file, context) => {
    const slugs = new Set<string>();
    const ciks = new Set<string>();
    for (const family of file.families) {
      if (slugs.has(family.slug)) {
        context.addIssue({ code: "custom", message: `duplicate family ${family.slug}` });
      }
      slugs.add(family.slug);
      for (const cik of family.ciks) {
        if (ciks.has(cik))
          context.addIssue({ code: "custom", message: `CIK ${cik} in two families` });
        ciks.add(cik);
      }
    }
  });

export type FilerFamilies = z.infer<typeof familiesSchema>;
export type FilerFamily = FilerFamilies["families"][number];

export function parseFilerFamilies(text: string): FilerFamilies {
  return familiesSchema.parse(JSON.parse(text));
}

/** CIK (unpadded) → family slug; a CIK in no family maps to `cik-<CIK>`. */
export function familyLookup(families: FilerFamilies): (cik: string) => string {
  const byCik = new Map<string, string>();
  for (const family of families.families) {
    for (const cik of family.ciks) byCik.set(cik, family.slug);
  }
  return (cik) => byCik.get(cik.replace(/^0+/, "")) ?? `cik-${cik.replace(/^0+/, "")}`;
}
