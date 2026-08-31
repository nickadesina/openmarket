import { ServiceError } from "../api/errors.js";

export interface OriginEnvironment {
  readonly APP_ORIGIN?: string | undefined;
  readonly VERCEL_URL?: string | undefined;
  readonly VERCEL_BRANCH_URL?: string | undefined;
  readonly NODE_ENV?: string | undefined;
  readonly PORT?: string | undefined;
}

function parseOrigin(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL`);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${label} must contain only an HTTP(S) scheme and host`);
  }

  return url;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function addConfiguredOrigin(
  origins: Set<string>,
  value: string | undefined,
  label: string,
  development: boolean,
): void {
  if (value === undefined || value.trim() === "") {
    return;
  }

  const url = parseOrigin(value.trim(), label);
  if (!development && isLoopbackHostname(url.hostname)) {
    return;
  }
  origins.add(url.origin);
}

function addVercelOrigin(
  origins: Set<string>,
  value: string | undefined,
  label: string,
  development: boolean,
): void {
  if (value === undefined || value.trim() === "") {
    return;
  }

  const trimmed = value.trim();
  const url = parseOrigin(
    trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    label,
  );
  if (url.protocol !== "https:") {
    throw new Error(`${label} must resolve to an HTTPS origin`);
  }
  if (!development && isLoopbackHostname(url.hostname)) {
    return;
  }
  origins.add(url.origin);
}

export function allowedOrigins(env: OriginEnvironment): ReadonlySet<string> {
  const origins = new Set<string>();
  const development = env.NODE_ENV === "development";

  addConfiguredOrigin(
    origins,
    env.APP_ORIGIN,
    "APP_ORIGIN",
    development,
  );
  addVercelOrigin(
    origins,
    env.VERCEL_URL,
    "VERCEL_URL",
    development,
  );
  addVercelOrigin(
    origins,
    env.VERCEL_BRANCH_URL,
    "VERCEL_BRANCH_URL",
    development,
  );

  if (development) {
    const port = env.PORT ?? "3000";
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65_535) {
      throw new Error("PORT must be an integer from 0 through 65535");
    }
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
    origins.add(`http://[::1]:${port}`);
  }

  return origins;
}

export function assertAllowedOrigin(
  origin: string | null | undefined,
  env: OriginEnvironment,
): asserts origin is string {
  if (origin === null || origin === undefined) {
    throw new ServiceError("INVALID_INPUT", "Request origin is required");
  }

  let normalized: string;
  try {
    normalized = parseOrigin(origin, "Origin").origin;
  } catch {
    throw new ServiceError("INVALID_INPUT", "Request origin is invalid");
  }

  if (!allowedOrigins(env).has(normalized)) {
    throw new ServiceError("INVALID_INPUT", "Request origin is not allowed");
  }
}
