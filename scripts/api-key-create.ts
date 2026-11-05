/**
 * Mints a reference API key (v1 README D14, kept in v2) and prints it once:
 *
 *   npm run api-key:create -- --name="Desk name"
 *   npm run api-key:create -- --name="Desk name" --quota=1200
 *   npm run api-key:create -- --name="Desk name" --tier=design_partner
 *
 * Only the key's SHA-256 is stored, so a lost key is replaced, not
 * recovered. `--quota` is requests per minute (default 600). `--tier` is
 * `standard` (default, never expires) or `design_partner`: the free trial
 * (docs/tradeables/feed-trial.md), which expires 365 days after creation and
 * is then refused with its expiry named. Revoke with
 * `update api_keys set revoked_at = now() where id = '<id>'`.
 */
import {
  API_KEY_TIERS,
  DEFAULT_KEY_QUOTA_PER_MINUTE,
  generateApiKey,
  hashApiKey,
  isApiKeyTier,
} from "../src/lib/auth/api-key.js";
import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { insertApiKey } from "../src/lib/services/ref-access.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const name = argument("name")?.trim() ?? "";
  if (name.length === 0 || name.length > 100) {
    throw new Error("--name is required (1–100 characters)");
  }
  const quotaArgument = argument("quota");
  const quota = quotaArgument === undefined ? DEFAULT_KEY_QUOTA_PER_MINUTE : Number(quotaArgument);
  if (!Number.isSafeInteger(quota) || quota <= 0) {
    throw new Error("--quota must be a positive integer");
  }
  const tier = argument("tier") ?? "standard";
  if (!isApiKeyTier(tier)) throw new Error(`--tier must be one of ${API_KEY_TIERS.join(", ")}`);

  const key = generateApiKey();
  const db = createDirectDatabase();
  try {
    const created = await insertApiKey(db, {
      name,
      keyHash: hashApiKey(key),
      quotaPerMinute: quota,
      tier,
    });
    console.log(`id: ${created.id}`);
    console.log(`name: ${created.name}`);
    console.log(`tier: ${created.tier}`);
    console.log(`quota_per_minute: ${created.quota_per_minute}`);
    console.log(`expires_at: ${created.expires_at?.toISOString() ?? "never"}`);
    console.log(`key: ${key}`);
    console.log("Store the key now: it is not saved and cannot be shown again.");
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error("API key creation failed", error instanceof Error ? error.message : "");
  process.exitCode = 1;
}
