import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  formatLogChange,
  formatPercent,
  formatPerShare,
  formatValuation,
  quarterId,
} from "../../src/components/index/format.js";
import { METHODOLOGY } from "../../src/lib/engine/index/methodology.js";
import { withLiveConstants } from "../../src/lib/tradeables/methodology-doc.js";

describe("/methodology's constants", () => {
  const source = readFileSync("METHODOLOGY.md", "utf8");
  const rendered = withLiveConstants(source);

  it("lists every engine constant with its live value and the file's meaning", () => {
    for (const [name, value] of Object.entries(METHODOLOGY)) {
      const row = rendered.split("\n").find((line) => line.startsWith(`| \`${name}\` |`));
      expect(row, name).toBeDefined();
      expect(row).toContain(`\`${String(value)}\``);
      expect(row).not.toContain("Not described in METHODOLOGY.md");
    }
  });

  it("changes nothing outside the table", () => {
    const outside = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.startsWith("| `"))
        .join("\n");
    expect(outside(rendered)).toBe(outside(source));
  });

  it("shows a constant the file does not describe", () => {
    const trimmed = source.replace(/^\| `leader_window_days` .*\n/m, "");
    expect(withLiveConstants(trimmed)).toContain(
      "| `leader_window_days` | `180` | Not described in METHODOLOGY.md. |",
    );
  });
});

describe("the pages' figures", () => {
  it("writes per-share marks with cents, small ones with four decimals", () => {
    expect(formatPerShare(777.53)).toBe("$777.53");
    expect(formatPerShare("589.00949996")).toBe("$589.01");
    expect(formatPerShare(0.4512)).toBe("$0.4512");
  });

  it("writes valuations the short way", () => {
    expect(formatValuation("965000000000")).toBe("$965B");
    expect(formatValuation(61_500_000_000)).toBe("$61.5B");
    expect(formatValuation(12_153_395)).toBe("$12.2M");
    expect(formatValuation(306_000)).toBe("$306,000");
  });

  it("writes dispersion and log changes as percents", () => {
    expect(formatPercent(32.0)).toBe("32.0%");
    expect(formatPercent(0.0000021)).toBe("<0.1%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatLogChange(Math.log(751.32 / 589.0095))).toBe("+27.6%");
    expect(formatLogChange(Math.log(0.5))).toBe("−50.0%");
  });

  it("anchors a label's quarter", () => {
    expect(quarterId("Series F-1 Preferred", "2026Q3")).toBe("series-f-1-preferred-2026q3");
  });
});
