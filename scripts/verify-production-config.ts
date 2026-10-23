import { pathToFileURL } from "node:url";
import { CRON_SECRET_MIN_LENGTH } from "../src/lib/auth/cron.js";

export type DeploymentTarget = "preview" | "production";

type Environment = Readonly<Record<string, string | undefined>>;

const PLACEHOLDER_PATTERN =
  /(?:^|[^a-z0-9])(?:change[-_ ]?me|replace[-_ ]?me|your[-_ ]?(?:secret|value|url|host|id)|test[-_ ]?(?:secret|value|password)|placeholder|example(?:\.com)?|dummy|sample|fake|password|todo|tbd|draft|unverified)(?:$|[^a-z0-9])/i;
const NEON_HOST_SUFFIX = ".neon.tech";
const POOLER_MARKER = "-pooler.";

function fail(message: string): never {
  throw new Error(message);
}

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    fail(`${name} is required`);
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    fail(`${name} must not contain a placeholder value`);
  }
  return value;
}

function parsePostgresUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} must be a valid PostgreSQL URL`);
  }

  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    url.username.length === 0 ||
    url.password.length === 0 ||
    url.hostname.length === 0 ||
    url.pathname === "/" ||
    url.hash.length > 0
  ) {
    fail(`${name} must contain PostgreSQL credentials, host, and database name`);
  }
  if (!url.hostname.endsWith(NEON_HOST_SUFFIX)) {
    fail(`${name} must use a Neon hostname`);
  }
  if (url.searchParams.get("sslmode") !== "require") {
    fail(`${name} must set sslmode=require`);
  }

  return url;
}

function validateDatabaseUrls(environment: Environment): string {
  const pooledValue = required(environment, "DATABASE_URL");
  const directValue = required(environment, "DATABASE_URL_UNPOOLED");
  if (pooledValue === directValue) {
    fail("DATABASE_URL and DATABASE_URL_UNPOOLED must be distinct");
  }

  const pooled = parsePostgresUrl(pooledValue, "DATABASE_URL");
  const direct = parsePostgresUrl(directValue, "DATABASE_URL_UNPOOLED");
  if (!pooled.hostname.includes(POOLER_MARKER)) {
    fail("DATABASE_URL must use the Neon pooled endpoint");
  }
  if (direct.hostname.includes(POOLER_MARKER)) {
    fail("DATABASE_URL_UNPOOLED must use the Neon direct endpoint");
  }
  if (pooled.hostname.replace(POOLER_MARKER, ".") !== direct.hostname) {
    fail("DATABASE_URL and DATABASE_URL_UNPOOLED must address matching Neon endpoints");
  }
  if (
    pooled.username !== direct.username ||
    pooled.password !== direct.password ||
    pooled.pathname !== direct.pathname ||
    pooled.port !== direct.port
  ) {
    fail("DATABASE_URL and DATABASE_URL_UNPOOLED must use the same role and database");
  }

  return direct.hostname;
}

function validateAppOrigin(environment: Environment): void {
  const value = required(environment, "APP_ORIGIN");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("APP_ORIGIN must be a valid absolute HTTPS origin");
  }

  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  ) {
    fail("APP_ORIGIN must contain only a public HTTPS scheme and host");
  }
}

function validateBranchAssignment(
  environment: Environment,
  target: DeploymentTarget,
  directHostname: string,
): void {
  const vercelEnvironment = required(environment, "VERCEL_ENV");
  const branchRole = required(environment, "NEON_BRANCH_ROLE");
  const branchId = required(environment, "NEON_BRANCH_ID");
  const productionBranchId = required(environment, "PRODUCTION_NEON_BRANCH_ID");
  const productionHostname = required(environment, "PRODUCTION_DATABASE_HOST").toLowerCase();

  if (vercelEnvironment !== target || branchRole !== target) {
    fail("VERCEL_ENV and NEON_BRANCH_ROLE must match the requested deployment target");
  }
  if (
    productionHostname.includes("://") ||
    productionHostname.includes("/") ||
    productionHostname.includes(":") ||
    productionHostname.includes(POOLER_MARKER) ||
    !productionHostname.endsWith(NEON_HOST_SUFFIX)
  ) {
    fail("PRODUCTION_DATABASE_HOST must be the direct production Neon hostname only");
  }

  if (target === "production") {
    if (branchId !== productionBranchId || directHostname !== productionHostname) {
      fail("Production deployment is not assigned to the declared production Neon branch");
    }
    return;
  }

  if (branchId === productionBranchId || directHostname === productionHostname) {
    fail("Preview deployment must use an isolated non-production Neon branch");
  }
}

export function validateDeploymentConfig(
  environment: Environment,
  target: DeploymentTarget,
  nodeVersion = process.versions.node,
): void {
  if (nodeVersion.split(".")[0] !== "22") {
    fail("OpenMarket deployments require Node.js 22.x");
  }

  if ((environment.CRON_SECRET?.trim().length ?? 0) < CRON_SECRET_MIN_LENGTH) {
    const message = "CRON_SECRET must contain at least 16 characters";
    if (target === "production") fail(message);
    console.warn(`${message}; preview cron routes will be unavailable`);
  }

  const directHostname = validateDatabaseUrls(environment);
  validateAppOrigin(environment);
  validateBranchAssignment(environment, target, directHostname);
}

function parseTarget(arguments_: readonly string[]): DeploymentTarget {
  if (arguments_.length !== 1) {
    fail("Usage: verify-production-config.ts --target=production|preview");
  }
  const argument = arguments_[0];
  if (argument === "--target=production") {
    return "production";
  }
  if (argument === "--target=preview") {
    return "preview";
  }
  return fail("Usage: verify-production-config.ts --target=production|preview");
}

async function main(): Promise<void> {
  const target = parseTarget(process.argv.slice(2));
  validateDeploymentConfig(process.env, target);
  console.log(`${target} deployment configuration is valid`);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  try {
    await main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Deployment configuration is invalid: ${message}`);
    process.exitCode = 1;
  }
}
