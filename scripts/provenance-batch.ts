/**
 * Runs the provenance job once: commits every completed hour's forecast
 * hashes to a Merkle root, then posts or confirms each pending memo when
 * SOLANA_PROVENANCE_SECRET_KEY is set. Safe to re-run.
 *
 *   npm run provenance:batch
 */
import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { runProvenance } from "../src/lib/services/tournament/provenance.js";
import { solanaConfig } from "../src/lib/solana/memo.js";

const db = createDirectDatabase();
try {
  const run = await runProvenance(db, solanaConfig());
  console.log(JSON.stringify(run, null, 2));
  if ((run.posting?.errors.length ?? 0) > 0) process.exitCode = 1;
} catch (error: unknown) {
  // Database and RPC errors can carry connection details; keep diagnostics secret-free.
  console.error("Provenance run failed", error instanceof Error ? error.name : "");
  process.exitCode = 1;
} finally {
  await destroyDatabase(db);
}
