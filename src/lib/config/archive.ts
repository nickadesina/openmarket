/**
 * This deployment is the archived v1 (decision 0003): the dealer, the forward
 * and the tournament as they stood at v1's last dealer run. Every read is
 * answered at that instant, so a quote does not drift into "not trading" as
 * real time passes an instrument's expiry, and every write is refused by
 * `src/proxy.ts`.
 */
export const ARCHIVE_AS_OF_ISO = "2026-11-05T04:50:24.252Z";

/** The archive's clock: always v1's last dealer run, as a fresh Date. */
export function archiveNow(): Date {
  return new Date(ARCHIVE_AS_OF_ISO);
}

/** The live site that replaced v1. */
export const CURRENT_SITE_URL = "https://openmarket.systems";
