/**
 * Re-reads every live filer mark's security label with the methodology's
 * classifier and publishes the differences as one `parser` correction (new
 * rows, the old ones superseded): `npm run index:relabel [-- --dry-run]`.
 * Idempotent. Prints the live label counts per issuer before and after.
 * Uses DATABASE_URL_UNPOOLED.
 */
import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { liveLabelCounts, relabelMarks } from "../src/lib/services/index/relabel-marks.js";

function printCounts(title: string, counts: Awaited<ReturnType<typeof liveLabelCounts>>): void {
  console.log(`\n${title}`);
  let issuer = "";
  for (const row of counts) {
    if (row.issuer !== issuer) {
      issuer = row.issuer;
      const total = counts
        .filter((other) => other.issuer === issuer)
        .reduce((sum, other) => sum + other.rows, 0);
      console.log(`  ${issuer} (${total})`);
    }
    console.log(`    ${row.label}: ${row.rows}`);
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const db = createDirectDatabase();
  try {
    printCounts("live labels before", await liveLabelCounts(db));
    const report = await relabelMarks(db, { dryRun });
    console.log(
      `\n${report.changedRows} of ${report.liveRows} live marks ${dryRun ? "would get" : "got"} a new label or kind (${report.perShareChanged} a new per-share mark)${report.correctionId === null ? "" : `; correction ${report.correctionId}`}`,
    );
    for (const change of report.changes) {
      console.log(
        `  ${change.issuer}: ${change.fromLabel} (${change.fromKind}) -> ${change.toLabel} (${change.toKind}): ${change.rows}`,
      );
    }
    if (!dryRun) printCounts("live labels after", await liveLabelCounts(db));
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error("index:relabel failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
