/**
 * Publishes a methodology change as a correction (decision 0003 §5;
 * METHODOLOGY.md, "Versioning and corrections"): one `corrections` row of
 * kind `methodology`, under the version it introduces, with the diff in
 * Markdown and, as `affected`, the constants of that version and every
 * watchlisted name's headline recomputed under it. A methodology change
 * writes no `filer_marks` row: the filers' rows are unchanged, and every
 * derived figure is recomputed from them under the new version.
 *
 * Idempotent: a second call for the same kind and version finds the row and
 * writes nothing. `row` and `parser` corrections are written with the rows
 * they correct (import-certificates.ts, relabel-marks.ts), not here.
 */
import { type Kysely, sql } from "kysely";

import type { Database } from "../../db/schema.js";
import type { FilerFamilies } from "../../engine/index/families.js";
import { METHODOLOGY, METHODOLOGY_VERSION } from "../../engine/index/methodology.js";
import { listNames } from "./list-names.js";
import { PUBLISHED_FILER_FAMILIES } from "./published-families.js";

export interface MethodologyCorrectionInput {
  /** The methodology version the change introduces; must be the version in force. */
  readonly version: string;
  /** What changed and why, in one or two sentences. */
  readonly summary: string;
  /** The diff, in Markdown. */
  readonly diffMd: string;
  /** Where the diff was read from, recorded with it. */
  readonly diffPath: string;
  readonly families?: FilerFamilies;
  readonly now?: () => Date;
}

export type MethodologyCorrectionResult =
  | { readonly status: "inserted"; readonly correctionId: string; readonly names: number }
  | { readonly status: "exists"; readonly correctionId: string; readonly publishedAt: Date };

const VERSION = /^\d+\.\d+\.\d+$/;

export async function recordMethodologyCorrection(
  db: Kysely<Database>,
  input: MethodologyCorrectionInput,
): Promise<MethodologyCorrectionResult> {
  if (!VERSION.test(input.version)) throw new RangeError("version must be like 0.2.0");
  if (input.version !== METHODOLOGY_VERSION) {
    throw new RangeError(
      `version ${input.version} is not the methodology in force (${METHODOLOGY_VERSION}): the correction records the figures this code computes`,
    );
  }
  if (input.summary.trim() === "") throw new RangeError("a correction needs a summary");
  if (input.diffMd.trim() === "") throw new RangeError("a correction needs a diff");
  const now = input.now ?? (() => new Date());

  return db.transaction().execute(async (trx) => {
    // One writer per kind and version at a time, so two runs cannot both insert.
    await sql`select pg_advisory_xact_lock(hashtext(${`corrections:methodology:${input.version}`}))`.execute(
      trx,
    );
    const existing = await trx
      .selectFrom("corrections")
      .select(["id", "published_at"])
      .where("kind", "=", "methodology")
      .where("methodology_version", "=", input.version)
      .orderBy("published_at")
      .executeTakeFirst();
    if (existing !== undefined) {
      return { status: "exists", correctionId: existing.id, publishedAt: existing.published_at };
    }

    const at = now();
    const list = await listNames(trx, {
      families: input.families ?? PUBLISHED_FILER_FAMILIES,
      now: () => at,
    });
    const names = list.names.map((row) => ({
      slug: row.slug,
      security_label: row.security_label,
      as_of: row.as_of,
      consensus_usd: row.consensus_usd,
      n_families: row.n_families,
      dispersion_pct: row.dispersion_pct,
      no_headline: row.no_headline?.code ?? null,
    }));
    const row = await trx
      .insertInto("corrections")
      .values({
        published_at: at,
        methodology_version: input.version,
        kind: "methodology",
        summary: input.summary.trim(),
        diff_md: input.diffMd,
        affected: JSON.stringify({
          methodology_version: input.version,
          diff: input.diffPath,
          families_version: list.families_version,
          constants: METHODOLOGY,
          headlines: names,
        }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { status: "inserted", correctionId: row.id, names: names.length };
  });
}
