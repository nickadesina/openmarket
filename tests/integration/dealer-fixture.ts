import { readFileSync } from "node:fs";

import type { Kysely } from "kysely";

import { DEALER_PARAMS } from "../../src/lib/config/dealer.js";
import {
  EVENTS_CSV_PATH,
  type ListingAnchor,
  listingAnchors,
  parseCsv,
  SOURCES_CSV_PATH,
} from "../../src/lib/config/listing-anchors.js";
import type { Database, EventFlagKind } from "../../src/lib/db/schema.js";
import { seedListings } from "../../src/lib/services/dealer/seed-listings.js";
import { ensurePaperAccount } from "../../src/lib/services/user.js";
import { type FixtureFlag, fixtureFlagsFor, utcDay } from "../services/event-flags-fixture.js";

/**
 * Shared setup for the dealer's PostgreSQL tests: listings from the seed
 * service with tests/fixtures/listing-sources.csv, users inserted directly,
 * and flags copied from tests/fixtures/event-flags.json. A flag's source URL
 * is the one backtest/data/sources.csv gives its round, the attachment the
 * ingest makes (decision 0001); the fixture itself carries none.
 */

export const NAMES = Object.keys(DEALER_PARAMS.forward_t_days);
const EVENTS = readFileSync(EVENTS_CSV_PATH, "utf8");
const LISTING_SOURCES = readFileSync("tests/fixtures/listing-sources.csv", "utf8");
const ROUND_SOURCES = parseCsv(readFileSync(SOURCES_CSV_PATH, "utf8"));

/** Each name's last priced round announced before `before` (YYYY-MM-DD), as listing anchors. */
export function anchorsBefore(before: string): ListingAnchor[] {
  const [header, ...rows] = EVENTS.split("\n");
  const kept = rows.filter((line) => {
    const date = line.split(",")[3];
    return date === undefined || date < before;
  });
  return listingAnchors([header, ...kept].join("\n"), LISTING_SOURCES, NAMES);
}

export async function seedFixtureListings(db: Kysely<Database>, listedAt: Date, before?: string) {
  const anchors = anchorsBefore(before ?? listedAt.toISOString().slice(0, 10));
  return seedListings(db, { listedAt, relist: false, anchors });
}

/** A user row with the opening balance; identity is not this suite's concern. */
export async function insertUser(db: Kysely<Database>, _name: string): Promise<string> {
  const tournamentUser = await db
    .insertInto("tournament_users")
    .defaultValues()
    .returning("id")
    .executeTakeFirstOrThrow();
  return ensurePaperAccount(db, tournamentUser.id);
}

/** The located source of a round announced on `date`, from backtest/data/sources.csv. */
function roundSourceUrl(company: string, date: string): string | null {
  const row = ROUND_SOURCES.find(
    (source) =>
      source.company!.toLowerCase().replaceAll(" ", "-") === company &&
      source.announcement_date === date &&
      source.source_url !== "",
  );
  return row?.source_url ?? null;
}

/** Inserts the fixture's flags of `slug` of these kinds, filtered by `keep`. */
export async function insertFixtureFlags(
  db: Kysely<Database>,
  slug: string,
  kinds: readonly EventFlagKind[],
  keep: (flag: FixtureFlag) => boolean = () => true,
): Promise<FixtureFlag[]> {
  const company = await db
    .selectFrom("companies")
    .select("id")
    .where("slug", "=", slug)
    .executeTakeFirstOrThrow();
  const flags = fixtureFlagsFor(slug, kinds).filter(keep);
  if (flags.length === 0) return [];
  await db
    .insertInto("event_flags")
    .values(
      flags.map((flag) => ({
        company_id: company.id,
        kind: flag.kind,
        source_url:
          flag.kind === "scoop" ? flag.source_url : roundSourceUrl(slug, flag.published_at),
        source_rank: flag.source_rank,
        observed_at: utcDay(flag.observed_at),
        published_at: utcDay(flag.published_at),
        terms_json: flag.terms,
        confidence: flag.confidence,
        dedupe_key: flag.dedupe_key,
      })),
    )
    .execute();
  return flags;
}
