import { Kysely, PostgresDialect, type PostgresPool } from "kysely";
import { Client, Pool, types } from "pg";

// A `date` column is a calendar day, not an instant. pg would otherwise
// parse it into a Date at local midnight, which the server and the browser
// then render in different zones (a hydration mismatch on every anchor).
// The schema declares these columns as strings; keep them "YYYY-MM-DD".
types.setTypeParser(types.builtins.DATE, (value) => value);

import type { Database } from "./schema.js";

/** One lease of the direct client: its queries, and a release that hands it to the next caller. */
interface DirectLease {
  query: Client["query"];
  release(error?: Error | boolean): void;
}

/**
 * One connection, leased to one caller at a time: Kysely acquires a
 * connection per query (or per transaction), so concurrent reads
 * (`Promise.all`) queue here instead of overlapping on the client, which pg
 * deprecates.
 */
class DirectClientPool {
  readonly options = Object.freeze({ direct: true });

  readonly #connectionString: string;
  #client: Promise<Client> | undefined;
  #destroyed = false;
  #free: Promise<void> = Promise.resolve();

  constructor(connectionString: string) {
    this.#connectionString = connectionString;
  }

  async connect(): Promise<DirectLease> {
    if (this.#destroyed) {
      throw new Error("The direct database client is destroyed");
    }

    this.#client ??= this.#open();
    const previous = this.#free;
    let release!: () => void;
    this.#free = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const client = await this.#client.catch((error: unknown) => {
      release();
      throw error;
    });
    let released = false;
    return {
      query: client.query.bind(client) as Client["query"],
      release: () => {
        if (released) return;
        released = true;
        release();
      },
    };
  }

  async end(): Promise<void> {
    this.#destroyed = true;

    if (this.#client === undefined) {
      return;
    }

    const client = await this.#client;
    await client.end();
  }

  async #open(): Promise<Client> {
    const client = new Client({ connectionString: this.#connectionString });
    await client.connect();
    return client;
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
