import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/logging/server-log.js", () => ({
  logReadRequest: vi.fn(),
  logMutationRequest: vi.fn(),
  logUnexpectedError: vi.fn(),
}));

import { GET } from "../../src/app/api/ref/rulebook/route.js";
import { RULEBOOK_VERSION, SOURCE_CLASSES } from "../../src/lib/engine/rulebook.js";
import { ENVELOPE_KEYS, LAG_NOTE } from "../../src/lib/services/index/ref-envelope.js";

describe("GET /api/ref/rulebook", () => {
  it("publishes the rulebook with its version and nothing of v1's dealer envelope", async () => {
    const response = await GET(new Request("http://localhost:3000/api/ref/rulebook"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    const body = await response.json();
    expect(Object.keys(body).slice(0, ENVELOPE_KEYS.length)).toEqual([...ENVELOPE_KEYS]);
    expect(body).toMatchObject({
      methodology_version: "0.2.0",
      ce_version: "0.1.0",
      lag_note: LAG_NOTE,
      rulebook_version: RULEBOOK_VERSION,
      rulebook: { version: RULEBOOK_VERSION, revision_window_days: 7 },
    });
    expect(Number.isNaN(Date.parse(body.as_of))).toBe(false);
    expect(body).not.toHaveProperty("model_version");
    expect(body).not.toHaveProperty("blend_version");
    expect(body.rulebook.source_ranks.map((row: { rank: number }) => row.rank)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(body.rulebook).not.toHaveProperty("binary");
    expect(body.rulebook).not.toHaveProperty("forward");
  });

  it("publishes the source-class table ingest stores ranks from", async () => {
    const body = await (await GET(new Request("http://localhost:3000/api/ref/rulebook"))).json();
    const classes = body.rulebook.source_classes.map(
      (row: { source_class: string }) => row.source_class,
    );
    expect(classes).toEqual([...SOURCE_CLASSES]);
    const filerMark = body.rulebook.source_purposes.find(
      (row: { purpose: string }) => row.purpose === "filer_mark",
    );
    expect(filerMark.ranks.slice(0, 2)).toEqual([
      { rank: 1, source_class: "ncsr" },
      { rank: 2, source_class: "nport" },
    ]);
    expect(body.not_built.map((row: { rule: string }) => row.rule)).toEqual([
      "contracts.observation",
      "contracts.versions",
    ]);
  });

  it("refuses unknown query parameters", async () => {
    const response = await GET(new Request("http://localhost:3000/api/ref/rulebook?v=2"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_INPUT");
  });
});
