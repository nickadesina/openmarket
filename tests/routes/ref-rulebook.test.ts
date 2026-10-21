import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/logging/server-log.js", () => ({
  logReadRequest: vi.fn(),
  logUnexpectedError: vi.fn(),
}));

import { GET } from "../../src/app/api/ref/rulebook/route.js";
import { MODEL_VERSION } from "../../src/lib/config/dealer.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/dealer/rulebook.js";

describe("GET /api/ref/rulebook", () => {
  it("publishes the rulebook with its versions", async () => {
    const response = await GET(new Request("http://localhost:3000/api/ref/rulebook"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      rulebook_version: RULEBOOK_VERSION,
      model_version: MODEL_VERSION,
      rulebook: { version: RULEBOOK_VERSION, revision_window_days: 7 },
    });
    expect(Number.isNaN(Date.parse(body.as_of))).toBe(false);
    expect(body.rulebook.source_ranks.map((row: { rank: number }) => row.rank)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("refuses unknown query parameters", async () => {
    const response = await GET(new Request("http://localhost:3000/api/ref/rulebook?v=2"));
    expect(response.status).toBe(400);
  });
});
