/**
 * Re-reads every live filer mark's security label with the methodology's
 * classifier (`classifySecurity`, src/lib/engine/index/series.ts) and, where
 * the stored label or kind differs, corrects it the way the index corrects
 * anything (docs/prompts/v2/README.md, "Data model"): one `corrections` row
 * of kind `parser`, a new `filer_marks` row per changed holding carrying that
 * correction's id, and the old row's `superseded_by` pointing at it. Nothing
 * is edited in place; the filer's figures are copied as filed.
 *
 * The per-share mark is copied, unless the per-share rule (`perShareMark`)
 * now says the row has none or has one, when it is recomputed in numeric.
 *
 * Idempotent: a rerun finds every live row already labelled as the
 * classifier reads it and writes nothing.
 */
import { type Kysely, sql } from "kysely";

import type { Database, SecurityKind } from "../../db/schema.js";
import { perShareMark } from "../../engine/index/mark.js";
import { METHODOLOGY_VERSION } from "../../engine/index/methodology.js";
import { classifySecurity } from "../../engine/index/series.js";

export const RELABEL_PARSER =
  "the methodology's classifier (engine/index/series.ts classifySecurity)";

export interface LabelChange {
  readonly issuer: string;
  readonly fromLabel: string;
  readonly fromKind: SecurityKind;
  readonly toLabel: string;
  readonly toKind: SecurityKind;
  readonly rows: number;
}

export interface RelabelReport {
  readonly liveRows: number;
  readonly changedRows: number;
  readonly perShareChanged: number;
  readonly correctionId: string | null;
  readonly changes: readonly LabelChange[];
}

export type Classifier = (
  title: string,
  name: string,
  assetCategory: string | null,
) => { readonly label: string; readonly kind: SecurityKind };

export interface RelabelOptions {
  /** Count what would change and write nothing. */
  readonly dryRun?: boolean;
  /** Defaults to the methodology's `classifySecurity`; `parser` names it in the correction. */
  readonly classify?: Classifier;
  readonly parser?: string;
  readonly now?: () => Date;
}

interface LiveMark {
  readonly id: string;
  readonly slug: string;
  readonly holding_title: string;
  readonly holding_name: string;
  readonly asset_category: string | null;
  readonly security_label: string;
  readonly security_kind: SecurityKind;
  readonly balance: string | null;
  readonly units: string | null;
  readonly value_usd: string;
  readonly mark_per_share_usd: string | null;
}

interface Planned {
  readonly mark: LiveMark;
  readonly label: string;
  readonly kind: SecurityKind;
  readonly perShare: "copy" | "recompute" | "clear";
}

function plan(mark: LiveMark, classify: Classifier): Planned | null {
  const { label, kind } = classify(mark.holding_title, mark.holding_name, mark.asset_category);
  const hasPerShare =
    perShareMark({
      valueUsd: Number(mark.value_usd),
      balance: mark.balance === null ? null : Number(mark.balance),
      units: mark.units,
    }) !== null;
  const stored = mark.mark_per_share_usd !== null;
  const perShare = hasPerShare === stored ? "copy" : hasPerShare ? "recompute" : "clear";
  if (label === mark.security_label && kind === mark.security_kind && perShare === "copy") {
    return null;
  }
  return { mark, label, kind, perShare };
}

function tally(planned: readonly Planned[]): LabelChange[] {
  const counts = new Map<string, LabelChange>();
  for (const { mark, label, kind } of planned) {
    const key = JSON.stringify([mark.slug, mark.security_label, mark.security_kind, label, kind]);
    const existing = counts.get(key);
    counts.set(key, {
      issuer: mark.slug,
      fromLabel: mark.security_label,
      fromKind: mark.security_kind,
      toLabel: label,
      toKind: kind,
      rows: (existing?.rows ?? 0) + 1,
    });
  }
  return [...counts.values()].sort(
    (a, b) =>
      a.issuer.localeCompare(b.issuer) || b.rows - a.rows || a.fromLabel.localeCompare(b.fromLabel),
  );
}

function diffMarkdown(changes: readonly LabelChange[]): string {
  const lines = [
    "| Issuer | Label as stored | Label as read now | Rows |",
    "| --- | --- | --- | --- |",
    ...changes.map(
      (change) =>
        `| ${change.issuer} | ${change.fromLabel} (${change.fromKind}) | ${change.toLabel} (${change.toKind}) | ${change.rows} |`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

async function liveMarks(db: Kysely<Database>): Promise<LiveMark[]> {
  return db
    .selectFrom("filer_marks")
    .innerJoin("issuers", "issuers.id", "filer_marks.issuer_id")
    .select([
      "filer_marks.id",
      "issuers.slug",
      "filer_marks.holding_title",
      "filer_marks.holding_name",
      "filer_marks.asset_category",
      "filer_marks.security_label",
      "filer_marks.security_kind",
      "filer_marks.balance",
      "filer_marks.units",
      "filer_marks.value_usd",
      "filer_marks.mark_per_share_usd",
    ])
    .where("filer_marks.superseded_by", "is", null)
    .orderBy("filer_marks.id")
    .execute();
}

const CHUNK = 500;

/** Corrects every live mark the classifier now reads differently, in one transaction. */
export async function relabelMarks(
  db: Kysely<Database>,
  options: RelabelOptions = {},
): Promise<RelabelReport> {
  const now = options.now ?? (() => new Date());
  const classify = options.classify ?? classifySecurity;
  const parser = options.parser ?? RELABEL_PARSER;
  return db.transaction().execute(async (trx) => {
    const live = await liveMarks(trx);
    const planned = live
      .map((mark) => plan(mark, classify))
      .filter((row): row is Planned => row !== null);
    const changes = tally(planned);
    const perShareChanged = planned.filter((row) => row.perShare !== "copy").length;
    const report = { liveRows: live.length, changedRows: planned.length, perShareChanged, changes };
    if (planned.length === 0 || options.dryRun === true) {
      return { ...report, correctionId: null };
    }

    const correction = await trx
      .insertInto("corrections")
      .values({
        published_at: now(),
        methodology_version: METHODOLOGY_VERSION,
        kind: "parser",
        summary: `Security labels re-read with ${parser}: ${planned.length} of ${live.length} live marks get a new label or kind${perShareChanged === 0 ? "" : `, ${perShareChanged} a new per-share mark`}. The filers' figures are unchanged.`,
        diff_md: diffMarkdown(changes),
        affected: JSON.stringify({
          parser,
          rows: planned.length,
          per_share_changed: perShareChanged,
          changes: changes.map((change) => ({
            issuer: change.issuer,
            from_label: change.fromLabel,
            from_kind: change.fromKind,
            to_label: change.toLabel,
            to_kind: change.toKind,
            rows: change.rows,
          })),
        }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    for (let start = 0; start < planned.length; start += CHUNK) {
      const chunk = planned.slice(start, start + CHUNK);
      const ids = chunk.map((row) => row.mark.id);
      const labels = chunk.map((row) => row.label);
      const kinds = chunk.map((row) => row.kind);
      const perShare = chunk.map((row) => row.perShare);
      // Copy each old row with its new label; the per-share mark stays numeric throughout.
      await sql`
        insert into filer_marks (
          document_id, issuer_id, holding_index, holding_name, holding_title, asset_category,
          security_label, security_kind, balance, units, value_usd, mark_per_share_usd,
          fair_value_level, is_restricted, as_of, correction_id
        )
        select f.document_id, f.issuer_id, f.holding_index, f.holding_name, f.holding_title,
          f.asset_category, p.label, p.kind, f.balance, f.units, f.value_usd,
          case p.per_share
            when 'copy' then f.mark_per_share_usd
            when 'recompute' then f.value_usd / f.balance
            else null
          end,
          f.fair_value_level, f.is_restricted, f.as_of, ${correction.id}::uuid
        from unnest(${ids}::uuid[], ${labels}::text[], ${kinds}::text[], ${perShare}::text[])
          as p(id, label, kind, per_share)
        join filer_marks f on f.id = p.id
      `.execute(trx);
      await sql`
        update filer_marks old set superseded_by = new.id
        from filer_marks new
        where old.id = any(${ids}::uuid[])
          and new.correction_id = ${correction.id}::uuid
          and new.document_id = old.document_id
          and new.issuer_id = old.issuer_id
          and new.holding_index = old.holding_index
      `.execute(trx);
    }
    return { ...report, correctionId: correction.id };
  });
}

/** Rows per issuer and label among live marks: the before and after of a relabel. */
export async function liveLabelCounts(
  db: Kysely<Database>,
): Promise<{ issuer: string; label: string; rows: number }[]> {
  const rows = await db
    .selectFrom("filer_marks")
    .innerJoin("issuers", "issuers.id", "filer_marks.issuer_id")
    .select(["issuers.slug as issuer", "filer_marks.security_label as label"])
    .select((eb) => eb.fn.countAll<string>().as("rows"))
    .where("filer_marks.superseded_by", "is", null)
    .groupBy(["issuers.slug", "filer_marks.security_label"])
    .orderBy("issuers.slug")
    .orderBy("rows", "desc")
    .execute();
  return rows.map((row) => ({ issuer: row.issuer, label: row.label, rows: Number(row.rows) }));
}
