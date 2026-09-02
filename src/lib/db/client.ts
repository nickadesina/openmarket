import { Kysely, PostgresDialect, type PostgresPool } from "kysely";
import { Client, Pool } from "pg";

import type { Database } from "./schema.js";

type DirectClient = Client & {
  release(error?: Error | boolean): void;
};

class DirectClientPool {
  readonly options = Object.freeze({ direct: true });

  readonly #connectionString: string;
  #client: Promise<DirectClient> | undefined;
  #destroyed = false;

  constructor(connectionString: string) {
    this.#connectionString = connectionString;
  }

  connect(): Promise<DirectClient> {
    if (this.#destroyed) {
      return Promise.reject(new Error("The direct database client is destroyed"));
    }

    this.#client ??= this.#open();
    return this.#client;
  }

  async end(): Promise<void> {
    this.#destroyed = true;

    if (this.#client === undefined) {
      return;
    }

    const client = await this.#client;
    await client.end();
  }

  async #open(): Promise<DirectClient> {
    const client = new Client({ connectionString: this.#connectionString });
    await client.connect();

    Object.defineProperty(client, "release", {
      configurable: false,
      enumerable: false,
      value: () => undefined,
      writable: false,
    });

    return client as DirectClient;
  }
}

function requireDatabaseUrl(
  connectionString: string | undefined,
  environmentVariable: "DATABASE_URL" | "DATABASE_URL_UNPOOLED",
): string {
  const value = connectionString?.trim() || process.env[environmentVariable]?.trim();

  if (value === undefined || value.length === 0) {
    throw new Error(`${environmentVariable} is required`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${environmentVariable} must be a valid PostgreSQL URL`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${environmentVariable} must be a valid PostgreSQL URL`);
  }

  return value;
}

export function createPooledDatabase(connectionString?: string): Kysely<Database> {
  const url = requireDatabaseUrl(connectionString, "DATABASE_URL");

  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: url, max: 2 }),
    }),
  });
}

export function createDirectDatabase(connectionString?: string): Kysely<Database> {
  const url = requireDatabaseUrl(connectionString, "DATABASE_URL_UNPOOLED");

  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new DirectClientPool(url) as PostgresPool,
    }),
  });
}

export async function destroyDatabase(db: Kysely<Database>): Promise<void> {
  await db.destroy();
}
