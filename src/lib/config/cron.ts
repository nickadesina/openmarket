/** Keep route maxDuration literals at this limit; cron-config tests enforce it. */
export const CRON_EXECUTION_SECONDS = 300;

export type ScheduledJob = "dealer" | "settle" | "provenance";

/** Vercel does not supply a delivery id: duplicate deliveries in a UTC slot share this key. */
export function vercelCronRunId(job: ScheduledJob, now: Date): string {
  const intervalMs = (job === "dealer" ? 15 : 60) * 60_000;
  const slot = new Date(Math.floor(now.getTime() / intervalMs) * intervalMs).toISOString();
  return `vercel:${job}:${slot.slice(0, job === "dealer" ? 16 : 13)}Z`;
}
