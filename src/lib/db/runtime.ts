import type { Kysely } from "kysely";

import { createPooledDatabase } from "./client.js";
import type { Database } from "./schema.js";

let warmProcessDatabase: Kysely<Database> | undefined;

export function getRuntimeDatabase(): Kysely<Database> {
  if (warmProcessDatabase === undefined) {
    warmProcessDatabase = createPooledDatabase();
  }
  return warmProcessDatabase;
}
