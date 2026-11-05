import { describe, expect, it } from "vitest";

import { cutForReading } from "../../scripts/export-ref-examples.js";

describe("export:ref-examples", () => {
  it("cuts arrays and long strings for reading and records every cut with its length", () => {
    const cuts: { path: string; length: number }[] = [];
    const payload = {
      names: [{ slug: "a" }, { slug: "b" }, { slug: "c" }],
      labels: [{ consensus: [1, 2, 3, 4] }],
      diff_md: "x".repeat(450),
      kept: "short",
    };
    expect(cutForReading(payload, "", cuts)).toEqual({
      names: [{ slug: "a" }, { slug: "b" }],
      labels: [{ consensus: [1, 2] }],
      diff_md: `${"x".repeat(400)}…`,
      kept: "short",
    });
    expect(cuts).toEqual([
      { path: "names", length: 3 },
      { path: "labels[0].consensus", length: 4 },
      { path: "diff_md", length: 450 },
    ]);
  });
});
