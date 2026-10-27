import { NOT_BUILT, RULEBOOK } from "../engine/dealer/rulebook.js";

/**
 * How /rulebook lays RULEBOOK out: sections in the order of CONTRACTS.md's
 * Definitions, each rule a path into RULEBOOK with its own anchor
 * (`#forward-acquisition`), so a reviewer can link one rule. Every label is
 * the rule's key; every value is RULEBOOK's. tests/tradeables/rulebook-page
 * fails if a rule is left out.
 */

export type RulePath = readonly string[];

export interface RuleSection {
  readonly title: string;
  readonly rules: readonly RulePath[];
}

const keys = (group: "binary" | "forward"): RulePath[] =>
  Object.keys(RULEBOOK[group]).map((key) => [group, key]);

export const RULEBOOK_SECTIONS: readonly RuleSection[] = [
  {
    title: "Print",
    rules: [
      ["print", "definition"],
      ["print", "also_for_labs"],
      ["print", "not_prints"],
      ["print", "conversions"],
    ],
  },
  { title: "Announcement", rules: [["announcement"]] },
  {
    title: "Source ranks",
    rules: [["source_ranks"], ["tier1_outlets"], ["syndication"], ["charter"], ["review"]],
  },
  {
    title: "Revision window and grace",
    rules: [["revision_window_days"], ["revision"], ["observation_grace_days"]],
  },
  { title: "Binary", rules: keys("binary") },
  { title: "Forward", rules: keys("forward") },
];

export function anchorOf(path: RulePath): string {
  return path.join("-").replaceAll("_", "-");
}

/** A key as a label: "also_for_labs" reads "Also for labs", "tier1_outlets" "Tier-1 outlets". */
export function labelOf(path: RulePath): string {
  const key = path
    .at(-1)!
    .replace(/^tier1/, "tier-1")
    .replaceAll("_", " ");
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function ruleAt(path: RulePath): unknown {
  let value: unknown = RULEBOOK;
  for (const key of path) {
    if (value === null || typeof value !== "object" || !(key in value)) {
      throw new Error(`RULEBOOK has no rule ${path.join(".")}`);
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** A number with the unit its key names: revision_window_days 7 reads "7 days". */
export function quantity(key: string, value: number): string {
  const unit = /_(days|hours)$/.exec(key)?.[1];
  if (unit === undefined) return String(value);
  return `${value} ${value === 1 ? unit.slice(0, -1) : unit}`;
}

export function notBuiltNote(path: RulePath): string | undefined {
  const rule = path.join(".");
  return NOT_BUILT.find((entry) => entry.rule === rule)?.note;
}

/** Every leaf rule in RULEBOOK, as paths, for the coverage test. */
export function leafRules(value: unknown = RULEBOOK, path: RulePath = []): RulePath[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [path];
  return Object.entries(value).flatMap(([key, child]) => leafRules(child, [...path, key]));
}
