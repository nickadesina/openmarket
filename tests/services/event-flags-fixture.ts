import { readFileSync } from "node:fs";

import type { EventFlagConfidence, EventFlagKind, JsonObject } from "../../src/lib/db/schema.js";

/**
 * tests/fixtures/event-flags.json (docs/decisions/0001), the only source of
 * flags a test may use. Dates are UTC days.
 */
export interface FixtureFlag {
  readonly company_slug: string;
  readonly listed: boolean;
  readonly kind: EventFlagKind;
  readonly published_at: string;
  readonly observed_at: string;
  readonly source_rank: number | null;
  readonly source_url: string | null;
  readonly terms: JsonObject;
  readonly confidence: EventFlagConfidence;
  readonly dedupe_key: string;
}

const fixture = JSON.parse(readFileSync("tests/fixtures/event-flags.json", "utf8")) as {
  readonly flags: readonly FixtureFlag[];
};

export const FIXTURE_FLAGS = fixture.flags;

export function fixtureFlagsFor(
  slug: string,
  kinds: readonly EventFlagKind[],
): readonly FixtureFlag[] {
  return FIXTURE_FLAGS.filter((flag) => flag.company_slug === slug && kinds.includes(flag.kind));
}

export function utcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
