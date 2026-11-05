/**
 * `GET /api/ref/corrections`: every published correction, newest first,
 * keyset-paginated (METHODOLOGY.md, "Versioning and corrections"). A
 * correction is a row with what changed, why, the diff and the rows
 * affected; the rows it wrote are new rows carrying its id (`filer_marks` and
 * `certificates.correction_id`), and the rows they replaced are superseded,
 * never edited.
 */
import { type Kysely, sql } from "kysely";

import type { Database, JsonValue } from "../../db/schema.js";
import { beforePosition, cursorAfter, cursorTime, decodeCursor, takePage } from "../ref-common.js";
import { type RefEnvelope, refEnvelope } from "./ref-envelope.js";

export interface RefCorrection {
  readonly correction_id: string;
  readonly published_at: string;
  /** The methodology in force when it was published. */
  readonly methodology_version: string;
  readonly kind: "row" | "methodology" | "parser";
  readonly summary: string;
  /** The diff, in Markdown. */
  readonly diff_md: string;
  /** What the correction touched, as recorded with it. */
  readonly affected: JsonValue;
  /** Rows written by the correction, by table. */
  readonly rows_written: { readonly filer_marks: number; readonly certificates: number };
}

export interface RefCorrectionsPayload extends RefEnvelope {
  readonly corrections: readonly RefCorrection[];
  readonly next_cursor: string | null;
}

export async function getRefCorrections(
  db: Kysely<Database>,
  query: { readonly limit: number; readonly cursor?: string | undefined },
  options: { readonly now: Date },
): Promise<RefCorrectionsPayload> {
  const { corrections: position } = decodeCursor(query.cursor, ["corrections"]);
  const envelope = refEnvelope(options.now);
  if (position === "end") return { ...envelope, corrections: [], next_cursor: null };
  let select = db
    .selectFrom("corrections")
    .select([
      "corrections.id",
      cursorTime("corrections.published_at").as("published_at"),
      "corrections.methodology_version",
      "corrections.kind",
      "corrections.summary",
      "corrections.diff_md",
      "corrections.affected",
      sql<string>`(select count(*) from filer_marks where filer_marks.correction_id = corrections.id)`.as(
        "filer_marks_written",
      ),
      sql<string>`(select count(*) from certificates where certificates.correction_id = corrections.id)`.as(
        "certificates_written",
      ),
    ]);
  if (position !== null) {
    select = select.where(
      beforePosition("corrections.published_at", "corrections.id", position, "uuid"),
    );
  }
  const fetched = await select
    .orderBy("corrections.published_at", "desc")
    .orderBy("corrections.id", "desc")
    .limit(query.limit + 1)
    .execute();
  const page = takePage(fetched, query.limit, (row) => ({ at: row.published_at, key: row.id }));
  return {
    ...envelope,
    corrections: page.items.map((row) => ({
      correction_id: row.id,
      published_at: row.published_at,
      methodology_version: row.methodology_version,
      kind: row.kind,
      summary: row.summary,
      diff_md: row.diff_md,
      affected: row.affected,
      rows_written: {
        filer_marks: Number(row.filer_marks_written),
        certificates: Number(row.certificates_written),
      },
    })),
    next_cursor: cursorAfter({ corrections: page.next }),
  };
}
