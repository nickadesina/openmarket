/**
 * This deployment is the archived v1 (decision 0003): the dealer, the forward
 * and the tournament as they stood at the last dealer run in the archive's
 * database (the Neon branch `v1-archive`, copied from the snapshot taken before
 * v2 migrated). Every read is answered at that instant, so a quote does not drift into "not trading" as
 * real time passes an instrument's expiry, and every write is refused by
 * `src/proxy.ts`.
 */
export const ARCHIVE_AS_OF_ISO = "2026-11-05T03:50:24.299Z";

/** The archive's clock: always that last dealer run, as a fresh Date. */
export function archiveNow(): Date {
  return new Date(ARCHIVE_AS_OF_ISO);
}

/** The live site that replaced v1. */
export const CURRENT_SITE_URL = "https://openmarket.systems";
