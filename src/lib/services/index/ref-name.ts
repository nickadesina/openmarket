/**
 * `GET /api/ref/[slug]`: one name's index (get-name-index.ts) under the
 * envelope, and the issuer lookup the other per-name routes share. An
 * unknown slug is `404 NAME_NOT_FOUND`.
 */
import type { Kysely } from "kysely";

import { ServiceError } from "../../api/errors.js";
import { parseSlug } from "../../api/pagination.js";
import type { Database } from "../../db/schema.js";
import type { FilerFamilies } from "../../engine/index/families.js";
import { getNameIndex, type NameIndex } from "./get-name-index.js";
import { PUBLISHED_FILER_FAMILIES } from "./published-families.js";

export interface RefNameOptions {
  readonly now: Date;
  readonly families?: FilerFamilies;
}

export function nameNotFound(slug: string): ServiceError {
  return new ServiceError("NAME_NOT_FOUND", `No name has the slug ${slug}.`, { slug });
}

export interface RefIssuer {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly listed_on: string | null;
}

/** The issuer with this slug, or `NAME_NOT_FOUND`; a malformed slug is `INVALID_INPUT`. */
export async function requireIssuer(db: Kysely<Database>, slug: string): Promise<RefIssuer> {
  const issuer = await db
    .selectFrom("issuers")
    .select(["id", "slug", "name", "listed_on"])
    .where("slug", "=", parseSlug(slug))
    .executeTakeFirst();
  if (issuer === undefined) throw nameNotFound(slug);
  return issuer;
}

export type RefNamePayload = NameIndex;

/** The whole name index; the per-name routes serve slices of it. */
export async function getRefName(
  db: Kysely<Database>,
  slug: string,
  options: RefNameOptions,
): Promise<RefNamePayload> {
  const index = await getNameIndex(db, parseSlug(slug), {
    families: options.families ?? PUBLISHED_FILER_FAMILIES,
    now: () => options.now,
  });
  if (index === null) throw nameNotFound(slug);
  return index;
}
