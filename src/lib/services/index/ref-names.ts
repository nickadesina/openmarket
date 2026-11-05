/**
 * `GET /api/ref/names`: the daily page's rows (list-names.ts) under the
 * envelope, computed with the published families.
 */
import type { Kysely } from "kysely";

import type { Database } from "../../db/schema.js";
import type { FilerFamilies } from "../../engine/index/families.js";
import { listNames, type NamesList } from "./list-names.js";
import { PUBLISHED_FILER_FAMILIES } from "./published-families.js";

export type RefNamesPayload = NamesList;

export function getRefNames(
  db: Kysely<Database>,
  options: { readonly now: Date; readonly families?: FilerFamilies },
): Promise<RefNamesPayload> {
  return listNames(db, {
    families: options.families ?? PUBLISHED_FILER_FAMILIES,
    now: () => options.now,
  });
}
