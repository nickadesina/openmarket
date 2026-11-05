import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSecClient,
  filingDocumentUrl,
  normalizeCik,
  nportPrimaryDocumentUrl,
  politeFetcher,
  requireSecUserAgent,
  SecFetchError,
} from "../../src/lib/ingest/fetch/sec.js";

const AGENT = "OpenMarket-Index/0.1 (+https://openmarket.systems)";

describe("SEC_USER_AGENT", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a name with an https URL or an email as the contact", () => {
    expect(requireSecUserAgent(` ${AGENT} `)).toBe(AGENT);
    expect(requireSecUserAgent("OpenMarket Research ops@example.org")).toBe(
      "OpenMarket Research ops@example.org",
    );
  });

  it.each([
    undefined,
    "",
    "OpenMarket-Index/0.1",
    "OpenMarket (+http://openmarket.systems)",
    "https://openmarket.systems",
    "ops@example.org",
  ])("refuses %s", (value) => {
    expect(() => requireSecUserAgent(value)).toThrow(/SEC_USER_AGENT/);
  });

  it("refuses to build a client without one", () => {
    vi.stubEnv("SEC_USER_AGENT", "");
    expect(() => createSecClient()).toThrow(/SEC_USER_AGENT/);
  });
});

describe("politeFetcher", () => {
  it("spaces request starts by the minimum gap and sends the headers", async () => {
    const starts: number[] = [];
    const seen: Headers[] = [];
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const get = politeFetcher({
      minGapMs: 150,
      headers: { "User-Agent": AGENT },
      fetch: async (_url, init) => {
        starts.push(clock);
        seen.push(new Headers(init?.headers));
        return new Response("ok");
      },
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    });
    await get("https://www.sec.gov/a");
    await get("https://www.sec.gov/b");
    await get("https://www.sec.gov/c");
    vi.restoreAllMocks();
    expect(starts).toEqual([0, 150, 300]);
    expect(seen[0]?.get("user-agent")).toBe(AGENT);
  });

  it("backs off on 429 and 5xx, honouring a longer Retry-After, then gives up", async () => {
    const waits: number[] = [];
    const statuses = [429, 503, 200];
    const get = politeFetcher({
      minGapMs: 0,
      fetch: async () =>
        new Response("x", {
          status: statuses.shift() ?? 500,
          headers: { "retry-after": "5" },
        }),
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });
    expect((await get("https://www.sec.gov/a")).status).toBe(200);
    expect(waits).toEqual([5_000, 5_000]);

    const always = politeFetcher({
      minGapMs: 0,
      retries: 2,
      fetch: async () => new Response("x", { status: 500 }),
      sleep: async () => undefined,
    });
    expect((await always("https://www.sec.gov/a")).status).toBe(500);
  });

  it("retries a network error and rethrows the last one", async () => {
    let calls = 0;
    const get = politeFetcher({
      minGapMs: 0,
      retries: 1,
      fetch: async () => {
        calls += 1;
        throw new Error("reset");
      },
      sleep: async () => undefined,
    });
    await expect(get("https://www.sec.gov/a")).rejects.toThrow("reset");
    expect(calls).toBe(2);
  });
});

describe("SEC client", () => {
  it("returns text and JSON, and throws a SecFetchError on a refusal", async () => {
    const client = createSecClient({
      userAgent: AGENT,
      minGapMs: 0,
      sleep: async () => undefined,
      fetch: async (url) =>
        url.endsWith(".json")
          ? Response.json({ ok: true })
          : url.endsWith("missing")
            ? new Response("no", { status: 404 })
            : new Response("<xml/>"),
    });
    expect(await client.text("https://www.sec.gov/doc.xml")).toBe("<xml/>");
    expect(await client.json("https://data.sec.gov/x.json")).toEqual({ ok: true });
    await expect(client.text("https://www.sec.gov/missing")).rejects.toBeInstanceOf(SecFetchError);
  });

  it("builds archive URLs without CIK padding or accession dashes", () => {
    expect(normalizeCik("0000707823")).toBe("707823");
    expect(() => normalizeCik("abc")).toThrow();
    expect(nportPrimaryDocumentUrl("0000707823", "0000035402-26-006778")).toBe(
      "https://www.sec.gov/Archives/edgar/data/707823/000003540226006778/primary_doc.xml",
    );
    expect(filingDocumentUrl("707823", "0000035402-26-006778", "QTLY_7524_20260831.htm")).toBe(
      "https://www.sec.gov/Archives/edgar/data/707823/000003540226006778/QTLY_7524_20260831.htm",
    );
  });
});
