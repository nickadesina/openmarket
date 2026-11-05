import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/logging/server-log.js", () => ({
  logReadRequest: vi.fn(),
  logMutationRequest: vi.fn(),
  logUnexpectedError: vi.fn(),
}));

const runtime = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn(() => ({ fake: "db" })) }));
vi.mock("../../src/lib/db/runtime.js", () => runtime);

const services = vi.hoisted(() => ({
  getRefNames: vi.fn(),
  getRefName: vi.fn(),
  getRefMarks: vi.fn(),
  getRefRevisions: vi.fn(),
  getRefSpv: vi.fn(),
  getRefMethodology: vi.fn(),
  getRefCorrections: vi.fn(),
}));
vi.mock("../../src/lib/services/index/ref-names.js", () => ({ getRefNames: services.getRefNames }));
vi.mock("../../src/lib/services/index/ref-name.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/services/index/ref-name.js")>()),
  getRefName: services.getRefName,
}));
vi.mock("../../src/lib/services/index/ref-marks.js", () => ({ getRefMarks: services.getRefMarks }));
vi.mock("../../src/lib/services/index/ref-revisions.js", () => ({
  getRefRevisions: services.getRefRevisions,
}));
vi.mock("../../src/lib/services/index/ref-spv.js", () => ({ getRefSpv: services.getRefSpv }));
vi.mock("../../src/lib/services/index/ref-methodology.js", () => ({
  getRefMethodology: services.getRefMethodology,
}));
vi.mock("../../src/lib/services/index/ref-corrections.js", () => ({
  getRefCorrections: services.getRefCorrections,
}));

import { readFileSync } from "node:fs";
import { GET as marksRoute } from "../../src/app/api/ref/[slug]/marks/route.js";
import { GET as revisionsRoute } from "../../src/app/api/ref/[slug]/revisions/route.js";
import { GET as nameRoute } from "../../src/app/api/ref/[slug]/route.js";
import { GET as spvRoute } from "../../src/app/api/ref/[slug]/spv/route.js";
import { GET as correctionsRoute } from "../../src/app/api/ref/corrections/route.js";
import { GET as methodologyRoute } from "../../src/app/api/ref/methodology/route.js";
import { GET as namesRoute } from "../../src/app/api/ref/names/route.js";
import { nameNotFound } from "../../src/lib/services/index/ref-name.js";

const ORIGIN = "http://localhost:3000";
const PUBLIC_CACHE = "public, max-age=60, s-maxage=60";

function get(path: string): Request {
  return new Request(`${ORIGIN}${path}`);
}

function slug(value: string) {
  return { params: Promise.resolve({ slug: value }) };
}

afterEach(() => {
  for (const service of Object.values(services)) service.mockReset();
});

describe("the index's reference routes", () => {
  it("serve each service's payload as JSON with the public cache", async () => {
    services.getRefNames.mockResolvedValue({ names: [] });
    const response = await namesRoute(get("/api/ref/names"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe(PUBLIC_CACHE);
    expect(await response.json()).toEqual({ names: [] });
    const [db, options] = services.getRefNames.mock.calls[0]!;
    expect(db).toEqual({ fake: "db" });
    expect(options.now).toBeInstanceOf(Date);
  });

  it("pass the slug through to the per-name services", async () => {
    for (const [route, service, path] of [
      [nameRoute, services.getRefName, "/api/ref/anthropic"],
      [revisionsRoute, services.getRefRevisions, "/api/ref/anthropic/revisions"],
      [spvRoute, services.getRefSpv, "/api/ref/anthropic/spv"],
    ] as const) {
      service.mockResolvedValue({ ok: path });
      const response = await route(get(path), slug("anthropic"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: path });
      expect(service.mock.calls[0]![1]).toBe("anthropic");
    }
  });

  it("answer an unknown slug with 404 NAME_NOT_FOUND, uncached", async () => {
    services.getRefName.mockRejectedValue(nameNotFound("no-such-name"));
    const response = await nameRoute(get("/api/ref/no-such-name"), slug("no-such-name"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "NAME_NOT_FOUND",
        message: "No name has the slug no-such-name.",
        details: { slug: "no-such-name" },
      },
    });
  });

  it("parse the marks query: limit, cursor, include and label", async () => {
    services.getRefMarks.mockResolvedValue({ marks: [] });
    await marksRoute(get("/api/ref/anthropic/marks"), slug("anthropic"));
    expect(services.getRefMarks.mock.calls[0]![2]).toEqual({
      limit: 200,
      cursor: undefined,
      include: "live",
      securityLabel: undefined,
    });
    await marksRoute(
      get(
        "/api/ref/anthropic/marks?limit=5&cursor=abc&include=superseded&label=Series%20F-1%20Preferred",
      ),
      slug("anthropic"),
    );
    expect(services.getRefMarks.mock.calls[1]![2]).toEqual({
      limit: 5,
      cursor: "abc",
      include: "superseded",
      securityLabel: "Series F-1 Preferred",
    });
  });

  it.each([
    "/api/ref/anthropic/marks?limit=0",
    "/api/ref/anthropic/marks?limit=1001",
    "/api/ref/anthropic/marks?include=all",
    "/api/ref/anthropic/marks?label=",
    "/api/ref/anthropic/marks?page=2",
  ])("refuse %s with 400 INVALID_INPUT", async (path) => {
    services.getRefMarks.mockResolvedValue({ marks: [] });
    const response = await marksRoute(get(path), slug("anthropic"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_INPUT");
  });

  it("add the families list to the methodology only on include=families", async () => {
    services.getRefMethodology.mockResolvedValue({});
    await methodologyRoute(get("/api/ref/methodology"));
    await methodologyRoute(get("/api/ref/methodology?include=families"));
    expect(services.getRefMethodology.mock.calls.map((call) => call[1])).toEqual([
      { includeFamilies: false },
      { includeFamilies: true },
    ]);
    expect((await methodologyRoute(get("/api/ref/methodology?include=x"))).status).toBe(400);
  });

  it("page the corrections", async () => {
    services.getRefCorrections.mockResolvedValue({ corrections: [] });
    await correctionsRoute(get("/api/ref/corrections?limit=10&cursor=xyz"));
    expect(services.getRefCorrections.mock.calls[0]![1]).toEqual({ limit: 10, cursor: "xyz" });
    expect((await correctionsRoute(get("/api/ref/corrections?include=x"))).status).toBe(400);
  });

  it("keep every watchlist slug clear of the routes' fixed segments", () => {
    const watchlist = JSON.parse(readFileSync("data/index/watchlist.json", "utf8")) as {
      names: { slug: string }[];
    };
    const fixed = ["names", "methodology", "corrections", "rulebook"];
    for (const name of watchlist.names) expect(fixed).not.toContain(name.slug);
  });
});
