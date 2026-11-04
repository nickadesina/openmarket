import { describe, expect, it } from "vitest";

import { type FamilyMarkPoint, familyMarks } from "../../../src/lib/engine/index/families.js";
import { daysBetween } from "../../../src/lib/engine/index/mark.js";
import { METHODOLOGY } from "../../../src/lib/engine/index/methodology.js";
import { revisions } from "../../../src/lib/engine/index/revisions.js";
import { EXAMPLE_FAMILIES, EXAMPLE_ROWS, toFundMark } from "./example-rows.js";

function point(familySlug: string, asOf: string, markPerShareUsd: number): FamilyMarkPoint {
  return {
    familySlug,
    familyName: familySlug,
    securityLabel: "Series A Preferred",
    asOf,
    markPerShareUsd,
  };
}

describe("revisions on the worked example (METHODOLOGY.md)", () => {
  const found = revisions(familyMarks(EXAMPLE_ROWS.map(toFundMark), EXAMPLE_FAMILIES));

  it("finds T. Rowe Price's and Capital Group's moves up, and the lag between them", () => {
    expect(found).toHaveLength(2);
    const [tRowe, capital] = found;
    expect(tRowe!.familyName).toBe("T. ROWE PRICE INTERNATIONAL FUNDS, INC.");
    expect(tRowe!.fromMarkUsd).toBeCloseTo(388.19, 10);
    expect(tRowe!.ln).toBeCloseTo(0.4169, 4);
    expect(tRowe!.role).toBe("leader");

    expect(capital!.familySlug).toBe("capital-group");
    expect(capital!.ln).toBeCloseTo(0.2434, 4);
    expect(capital!.direction).toBe("up");
    expect(capital!.role).toBe("follower");
    expect(capital!.leaderFamilySlug).toBe(tRowe!.familySlug);
    expect(capital!.lagDays).toBe(31);
  });
});

describe("revisions", () => {
  it("ignores a change below the threshold and counts one at it", () => {
    const below = Math.exp(METHODOLOGY.revision_threshold_ln * 0.99);
    const above = Math.exp(METHODOLOGY.revision_threshold_ln * 1.01);
    expect(
      revisions([point("a", "2026-03-31", 100), point("a", "2026-06-30", 100 * below)]),
    ).toEqual([]);
    expect(
      revisions([point("a", "2026-03-31", 100), point("a", "2026-06-30", 100 * above)]),
    ).toHaveLength(1);
  });

  it("compares consecutive marks only, whatever the input order", () => {
    const found = revisions([
      point("a", "2026-09-30", 120),
      point("a", "2026-03-31", 100),
      point("a", "2026-06-30", 100),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.fromAsOf).toBe("2026-06-30");
  });

  it("names the first other family to move the same way within the window", () => {
    const found = revisions([
      point("a", "2026-01-31", 100),
      point("a", "2026-03-31", 110),
      point("b", "2026-02-28", 100),
      point("b", "2026-04-30", 112),
      point("c", "2026-02-28", 100),
      point("c", "2026-05-31", 90),
    ]);
    const byFamily = new Map(found.map((revision) => [revision.familySlug, revision]));
    expect(byFamily.get("a")!.role).toBe("leader");
    expect(byFamily.get("b")!.leaderFamilySlug).toBe("a");
    expect(byFamily.get("b")!.lagDays).toBe(30);
    // c moved down: no family moved down before it.
    expect(byFamily.get("c")!.role).toBe("leader");
  });

  it("does not reach past the window, and same-day moves lead together", () => {
    // 2025-02-28 to 2025-12-31 is 306 days, past the window.
    expect(daysBetween("2025-02-28", "2025-12-31")).toBeGreaterThan(METHODOLOGY.leader_window_days);
    const late = revisions([
      point("a", "2025-01-31", 100),
      point("a", "2025-02-28", 110),
      point("b", "2025-01-31", 100),
      point("b", "2025-12-31", 110),
    ]);
    expect(late.every((revision) => revision.role === "leader")).toBe(true);

    const sameDay = revisions([
      point("a", "2026-01-31", 100),
      point("a", "2026-02-28", 110),
      point("b", "2026-01-31", 100),
      point("b", "2026-02-28", 120),
    ]);
    expect(sameDay.every((revision) => revision.role === "leader")).toBe(true);
  });

  it("records a write-down to zero with no log change", () => {
    const [found] = revisions([point("a", "2026-03-31", 5), point("a", "2026-06-30", 0)]);
    expect(found!.direction).toBe("down");
    expect(found!.ln).toBeNull();
  });
});
