import { describe, expect, it } from "vitest";

import { csvCell, csvLine, csvRecord, parseCsv } from "../../src/lib/tradeables/csv.js";

describe("CSV cells and records", () => {
  it("writes typed values: null empty, numbers and booleans as text, dates in UTC, structures as JSON", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell("777.53000000")).toBe("777.53000000");
    expect(csvCell(3)).toBe("3");
    expect(csvCell(false)).toBe("false");
    expect(csvCell(new Date("2026-08-31T00:00:00Z"))).toBe("2026-08-31T00:00:00.000Z");
    expect(csvCell([{ name: "A" }])).toBe('[{"name":"A"}]');
    expect(csvCell({ ratchet: "full" })).toBe('{"ratchet":"full"}');
  });

  it("quotes only the fields that need it, doubling quotes, CRLF-terminated (RFC 4180)", () => {
    expect(csvLine(["a", "b"])).toBe("a,b\r\n");
    expect(csvLine(["Anthropic, PBC", 'ANTHROPIC "F-1"', "line\nbreak", "cr\rhere", ""])).toBe(
      '"Anthropic, PBC","ANTHROPIC ""F-1""","line\nbreak","cr\rhere",\r\n',
    );
    expect(csvRecord([null, 1, true, { a: "x,y" }])).toBe(',1,true,"{""a"":""x,y""}"\r\n');
  });

  it("round-trips through the reader", () => {
    const rows = [
      ["holding_title", "value_usd", "note"],
      ['ANTHROPIC PBC SER F-1 CVT PFD PP "PHYSICAL"', "43283952.12", "a, b\r\nc"],
      ["Anthropic PBC, Series F-1", "", "plain"],
    ];
    const text = rows.map((row) => csvLine(row)).join("");
    expect(parseCsv(text)).toEqual([
      { holding_title: rows[1]![0], value_usd: rows[1]![1], note: rows[1]![2] },
      { holding_title: rows[2]![0], value_usd: "", note: "plain" },
    ]);
  });
});
