import { z } from "zod";

import { isServiceError } from "../src/lib/api/errors.js";
import { type SeedInput, seedInputSchema } from "../src/lib/api/schemas.js";
import { createDirectDatabase, destroyDatabase } from "../src/lib/db/client.js";
import { seedMarket } from "../src/lib/services/seed-market.js";
import { validateDeploymentConfig } from "./verify-production-config.js";

const SOURCE_VERIFICATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const REFUSED_TEXT_PATTERN =
  /(?:development\s+draft|\bdraft\b|unverified|not[- ]verified|placeholder|example\.com|change[-_ ]?me|replace[-_ ]?me|\btodo\b|\btbd\b)/i;

const verifiedSourceSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    url: z.url(),
    published_date: z.iso.date(),
    verified_at: z.iso.datetime({ offset: true }),
  })
  .strict();

const productionSeedRecordSchema = z
  .object({
    verification_status: z.literal("verified"),
    source: verifiedSourceSchema,
    seed: seedInputSchema,
  })
  .strict();

const productionSeedRecordsSchema = z.array(productionSeedRecordSchema).length(2);

type ProductionSeedRecord = z.infer<typeof productionSeedRecordSchema>;

function seedConfigurationError(message: string): never {
  throw new Error(`PRODUCTION_SEED_MARKETS_JSON ${message}`);
}

function parseSeedRecords(environment: NodeJS.ProcessEnv): readonly ProductionSeedRecord[] {
  const raw = environment.PRODUCTION_SEED_MARKETS_JSON?.trim();
  if (raw === undefined || raw.length === 0) {
    seedConfigurationError("is required");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    seedConfigurationError("must be valid JSON");
  }

  const result = productionSeedRecordsSchema.safeParse(parsed);
  if (!result.success) {
    seedConfigurationError("does not match the verified production seed schema");
  }
  return result.data;
}

function validatedSeedInputs(
  records: readonly ProductionSeedRecord[],
  now = Date.now(),
): readonly SeedInput[] {
  const expectedCompanies = new Map([
    ["stripe", "Stripe"],
    ["anthropic", "Anthropic"],
  ] as const);
  const seen = new Set<string>();
  const inputs: SeedInput[] = [];

  for (const record of records) {
    const input = record.seed;
    const expectedName = expectedCompanies.get(input.slug as "stripe" | "anthropic");
    if (expectedName === undefined || input.name !== expectedName || seen.has(input.slug)) {
      seedConfigurationError("must contain Stripe and Anthropic exactly once");
    }
    seen.add(input.slug);

    if (input.metric_kind !== "valuation_median") {
      seedConfigurationError("may contain only valuation anchors");
    }

    const source = record.source;
    if (
      REFUSED_TEXT_PATTERN.test(input.anchor_description) ||
      REFUSED_TEXT_PATTERN.test(source.title) ||
      REFUSED_TEXT_PATTERN.test(source.url)
    ) {
      seedConfigurationError("contains draft, unverified, or placeholder metadata");
    }

    let sourceUrl: URL;
    try {
      sourceUrl = new URL(source.url);
    } catch {
      seedConfigurationError("contains an invalid source URL");
    }
    if (
      sourceUrl.protocol !== "https:" ||
      sourceUrl.username.length > 0 ||
      sourceUrl.password.length > 0 ||
      sourceUrl.hostname === "localhost" ||
      sourceUrl.hostname === "127.0.0.1" ||
      sourceUrl.hostname === "[::1]" ||
      sourceUrl.hostname.endsWith(".local")
    ) {
      seedConfigurationError("requires a public HTTPS source URL");
    }

    const verifiedAt = Date.parse(source.verified_at);
    const publishedAt = Date.parse(`${source.published_date}T00:00:00.000Z`);
    const anchorAt = Date.parse(`${input.anchor_date}T00:00:00.000Z`);
    if (
      !Number.isFinite(verifiedAt) ||
      verifiedAt > now ||
      now - verifiedAt > SOURCE_VERIFICATION_MAX_AGE_MS
    ) {
      seedConfigurationError("requires source verification within the last 30 days");
    }
    if (publishedAt > now || anchorAt > now) {
      seedConfigurationError("must not contain future source or anchor dates");
    }

    const anchorDescription =
      `${input.anchor_description.trim()} Source: ${source.title.trim()} ` +
      `(${sourceUrl.href}); published ${source.published_date}; ` +
      `verified ${source.verified_at}.`;
    const validatedInput = seedInputSchema.safeParse({
      ...input,
      anchor_description: anchorDescription,
    });
    if (!validatedInput.success) {
      seedConfigurationError("contains source metadata too long to persist safely");
    }
    inputs.push(validatedInput.data);
  }

  if (seen.size !== expectedCompanies.size) {
    seedConfigurationError("must contain Stripe and Anthropic exactly once");
  }
  return inputs;
}

async function main(): Promise<void> {
  validateDeploymentConfig(process.env, "production");
  const inputs = validatedSeedInputs(parseSeedRecords(process.env));
  const db = createDirectDatabase();

  try {
    for (const input of inputs) {
      const result = await seedMarket(db, input);
      console.log(`Production seed ${result.outcome}: ${input.slug}`);
    }
  } finally {
    await destroyDatabase(db);
  }
}

try {
  await main();
} catch (error: unknown) {
  if (isServiceError(error)) {
    console.error(`Production seed refused: ${error.code}: ${error.message}`);
  } else if (
    error instanceof Error &&
    (error.message.startsWith("PRODUCTION_SEED_MARKETS_JSON") ||
      error.message.startsWith("Deployment") ||
      error.message.includes(" is required") ||
      error.message.includes(" must ") ||
      error.message.includes(" require"))
  ) {
    console.error(`Production seed refused: ${error.message}`);
  } else {
    console.error("Production seed failed before completion");
  }
  process.exitCode = 1;
}
