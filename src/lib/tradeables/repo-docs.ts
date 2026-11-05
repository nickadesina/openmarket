import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A document from the repository, read where it is kept so a page renders
 * the file itself. Pages that call this are static: the read happens at build.
 */
export function readRepoDoc(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

export const RULEBOOK_CHANGELOG_PATH = "docs/RULEBOOK_CHANGELOG.md";
export const RULEBOOK_REVIEWERS_PATH = "docs/RULEBOOK_REVIEWERS.md";
