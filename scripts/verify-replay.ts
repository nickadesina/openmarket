import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { verifyReplay } from "../src/lib/services/verify-replay.js";

async function main(): Promise<void> {
  const db = createDirectDatabase();

  try {
    const report = await verifyReplay(db);
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) {
      process.exitCode = 1;
    }
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch {
  // Database/driver errors can contain connection details. Keep diagnostics secret-free.
  console.error("Replay verification failed before diagnostics completed");
  process.exitCode = 1;
}
