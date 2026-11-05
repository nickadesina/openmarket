/**
 * Drafts data/index/filer-families.json from EDGAR (`npm run index:families`):
 * for every registrant in data/index/filings-by-name.csv, the investment
 * adviser its latest N-CEN names for every one of its funds. Registrants
 * whose funds share an adviser (or an adviser of one complex, below) form a
 * family; a registrant whose funds name different advisers, or that files
 * no N-CEN, is its own family. Families already in the file are kept as
 * they are (Nick edits the file); only new CIKs are added.
 */
import { filingDocumentUrl, type SecClient } from "../../ingest/fetch/sec.js";
import type { FilerFamilies, FilerFamily } from "../../ingest/parse/families.js";
import { type NcenAdviser, parseNcen, registrantAdvisers } from "../../ingest/parse/ncen.js";
import { parseSubmissions, submissionsUrl } from "../../ingest/parse/submissions.js";

/**
 * Adviser entities of one complex, which values its funds' private holdings
 * under one valuation process. The rule is the adviser's name as N-CEN gives
 * it; anything not listed groups by its own SEC file number.
 */
export const ADVISER_COMPLEXES: readonly {
  readonly pattern: RegExp;
  readonly slug: string;
  readonly name: string;
}[] = [
  {
    pattern: /^(?:Fidelity Management|FMR\b|Fidelity Diversifying)/i,
    slug: "fidelity-fmr",
    name: "Fidelity (FMR)",
  },
  { pattern: /^T\.? ?Rowe Price/i, slug: "t-rowe-price", name: "T. Rowe Price" },
  {
    pattern: /^Capital Research (?:and|&) Management/i,
    slug: "capital-group",
    name: "Capital Group",
  },
  { pattern: /^BlackRock/i, slug: "blackrock", name: "BlackRock" },
  { pattern: /^Morgan Stanley/i, slug: "morgan-stanley", name: "Morgan Stanley" },
  {
    // Putnam has been Franklin Templeton's since 2024.
    pattern: /^(?:Franklin|Templeton|Legg Mason|ClearBridge|Putnam)/i,
    slug: "franklin-templeton",
    name: "Franklin Templeton",
  },
  { pattern: /^Invesco/i, slug: "invesco", name: "Invesco" },
  { pattern: /^(?:J\.? ?P\.? ?Morgan|JPMorgan)/i, slug: "jpmorgan", name: "J.P. Morgan" },
  { pattern: /^Goldman Sachs/i, slug: "goldman-sachs", name: "Goldman Sachs" },
  { pattern: /^(?:Teachers Advisors|Nuveen)/i, slug: "nuveen", name: "Nuveen (TIAA)" },
  { pattern: /^(?:Massachusetts Financial Services|MFS\b)/i, slug: "mfs", name: "MFS" },
  {
    pattern: /^New York Life Investment/i,
    slug: "new-york-life",
    name: "New York Life Investments",
  },
  { pattern: /^(?:Fred Alger|Alger)/i, slug: "alger", name: "Alger" },
  { pattern: /^Baron/i, slug: "baron", name: "Baron Capital" },
  { pattern: /^ARK Invest/i, slug: "ark", name: "ARK Invest" },
  { pattern: /^(?:The )?Vanguard Group/i, slug: "vanguard", name: "Vanguard" },
  { pattern: /^Federated/i, slug: "federated-hermes", name: "Federated Hermes" },
  { pattern: /^Virtus/i, slug: "virtus", name: "Virtus" },
  { pattern: /^DoubleLine/i, slug: "doubleline", name: "DoubleLine" },
  {
    pattern: /^(?:Eaton Vance|Boston Management and Research)/i,
    slug: "eaton-vance",
    name: "Eaton Vance",
  },
  { pattern: /^(?:PGIM|AST Investment Services)/i, slug: "pgim", name: "PGIM (Prudential)" },
];

export interface RegistrantAdviser {
  readonly cik: string;
  readonly registrantName: string;
  readonly ncen: { readonly accession: string; readonly filedOn: string } | null;
  /** Every investment adviser its funds name in that N-CEN. */
  readonly advisers: readonly NcenAdviser[];
}

/** N-CENs read per registrant: a report can cover only a terminated series and name no adviser. */
const NCEN_ATTEMPTS = 3;

/** The advisers in the registrant's latest N-CEN that names any. */
export async function registrantAdviser(
  client: SecClient,
  cik: string,
  registrantName: string,
): Promise<RegistrantAdviser> {
  const submissions = parseSubmissions(await client.json(submissionsUrl(cik)));
  const reports = submissions.filings
    .filter((filing) => filing.form === "N-CEN")
    .sort((a, b) => b.filedOn.localeCompare(a.filedOn))
    .slice(0, NCEN_ATTEMPTS);
  let latest: RegistrantAdviser = { cik, registrantName, ncen: null, advisers: [] };
  for (const [index, ncen] of reports.entries()) {
    const report = parseNcen(
      await client.text(filingDocumentUrl(cik, ncen.accession, ncen.primaryDocument)),
    );
    const found = {
      cik,
      registrantName,
      ncen: { accession: ncen.accession, filedOn: ncen.filedOn },
      advisers: registrantAdvisers(report),
    };
    if (index === 0) latest = found;
    if (found.advisers.length > 0) return found;
  }
  return latest;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function familyKey(adviser: NcenAdviser): { slug: string; name: string } {
  const complex = ADVISER_COMPLEXES.find((entry) => entry.pattern.test(adviser.name));
  if (complex !== undefined) return { slug: complex.slug, name: complex.name };
  return {
    slug: slugify(adviser.name.replace(/,? (?:LLC|L\.?P\.?|Inc\.?|Ltd\.?)$/i, "")),
    name: adviser.name,
  };
}

function adviserText(adviser: NcenAdviser): string {
  return adviser.fileNumber === null
    ? adviser.name
    : `${adviser.name} (SEC file ${adviser.fileNumber})`;
}

function registrantText(registrant: RegistrantAdviser): string {
  return `${registrant.registrantName} (CIK ${registrant.cik}${registrant.ncen === null ? "" : `, N-CEN ${registrant.ncen.accession} filed ${registrant.ncen.filedOn}`})`;
}

function ownFamilyEvidence(registrant: RegistrantAdviser): string {
  if (registrant.ncen === null) {
    return `Its own family: no N-CEN in its EDGAR submissions index. ${registrantText(registrant)}.`;
  }
  if (registrant.advisers.length === 0) {
    return `Its own family: its latest N-CEN names no investment adviser. ${registrantText(registrant)}.`;
  }
  return `Its own family: its latest N-CEN names investment advisers of more than one firm across its funds (${registrant.advisers.map(adviserText).join("; ")}). ${registrantText(registrant)}.`;
}

/** Evidence for a family that gained registrants: a sentence grows, a list of URLs gets an item. */
function appendEvidence(
  evidence: FilerFamily["evidence"],
  addition: string,
): FilerFamily["evidence"] {
  return typeof evidence === "string"
    ? `${evidence} Added: ${addition}`
    : [...evidence, `Added: ${addition}`];
}

/** The families file with every registrant placed: existing families untouched, new CIKs added. */
export function buildFamilies(
  existing: FilerFamilies,
  registrants: readonly RegistrantAdviser[],
  version: string,
): FilerFamilies {
  type Draft = { -readonly [K in keyof FilerFamily]: FilerFamily[K] } & { ciks: string[] };
  const families = new Map<string, Draft>(
    existing.families.map((family) => [family.slug, { ...family, ciks: [...family.ciks] }]),
  );
  const placed = new Set(existing.families.flatMap((family) => family.ciks));
  const grouped = new Map<
    string,
    { name: string; advisers: Set<string>; members: RegistrantAdviser[] }
  >();

  for (const registrant of registrants) {
    if (placed.has(registrant.cik)) continue;
    placed.add(registrant.cik);
    const keys = new Map(registrant.advisers.map((adviser) => [familyKey(adviser).slug, adviser]));
    if (keys.size !== 1) {
      let slug = slugify(registrant.registrantName) || `cik-${registrant.cik}`;
      if (families.has(slug) || grouped.has(slug)) slug = `${slug}-${registrant.cik}`;
      families.set(slug, {
        slug,
        name: registrant.registrantName,
        ciks: [registrant.cik],
        evidence: ownFamilyEvidence(registrant),
      });
      continue;
    }
    const key = familyKey(registrant.advisers[0]!);
    const group = grouped.get(key.slug) ?? { name: key.name, advisers: new Set(), members: [] };
    for (const adviser of registrant.advisers) group.advisers.add(adviserText(adviser));
    group.members.push(registrant);
    grouped.set(key.slug, group);
  }

  for (const [slug, group] of grouped) {
    const evidence = `Investment advisers (one firm) of the funds in each registrant's latest N-CEN that names one: ${[...group.advisers].sort().join("; ")}. Registrants: ${group.members.map(registrantText).join("; ")}.`;
    const family = families.get(slug);
    if (family === undefined) {
      families.set(slug, {
        slug,
        name: group.name,
        ciks: group.members.map((member) => member.cik),
        evidence,
      });
    } else {
      family.ciks.push(...group.members.map((member) => member.cik));
      family.evidence = appendEvidence(family.evidence, evidence);
    }
  }

  return {
    version,
    ...(existing.note === undefined ? {} : { note: existing.note }),
    families: [...families.values()]
      .map((family) => ({
        ...family,
        ciks: [...new Set(family.ciks)].sort((a, b) => Number(a) - Number(b)),
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}
