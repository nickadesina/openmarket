import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/logging/server-log.js", () => ({
  logReadRequest: vi.fn(),
  logMutationRequest: vi.fn(),
  logUnexpectedError: vi.fn(),
}));

const { runScheduledIngest } = vi.hoisted(() => ({ runScheduledIngest: vi.fn() }));
vi.mock("../../src/lib/services/index/run-scheduled-ingest.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/lib/services/index/run-scheduled-ingest.js")
  >()),
  runScheduledIngest,
}));

import { GET, maxDuration } from "../../src/app/api/cron/ingest/route.js";
import { CRON_EXECUTION_SECONDS } from "../../src/lib/services/index/run-scheduled-ingest.js";

const SECRET = "a-long-enough-cron-secret";

function request(authorization?: string): Request {
  return new Request("http://localhost:3000/api/cron/ingest", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("GET /api/cron/ingest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    runScheduledIngest.mockReset();
  });

  it("runs within the limit the job plans for, daily on Vercel Cron", () => {
    expect(maxDuration).toBe(CRON_EXECUTION_SECONDS);
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const cron = vercel.crons.find((entry) => entry.path === "/api/cron/ingest");
    expect(cron?.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });

  it("refuses a caller without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const response = await GET(request("Bearer wrong"));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("CRON_UNAUTHORIZED");
    expect(runScheduledIngest).not.toHaveBeenCalled();
  });

  it("says it cannot run without SEC_USER_AGENT", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("SEC_USER_AGENT", "");
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("INGEST_UNAVAILABLE");
    expect(runScheduledIngest).not.toHaveBeenCalled();
  });

  it("runs each source and reports its run", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("SEC_USER_AGENT", "OpenMarket-Index/0.1 (+https://openmarket.systems)");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/never_connected");
    runScheduledIngest.mockResolvedValue({
      sources: [
        {
          source: "nport",
          since: "2026-10-28",
          report: {
            runId: "00000000-0000-4000-8000-000000000000",
            status: "ok",
            error: null,
            candidates: 2,
            documentsSeen: 2,
            documentsNew: 1,
            documentsSkipped: 1,
            marksNew: 3,
            supersededNew: 0,
            phraseOnly: [],
            failures: [],
            perIssuer: {},
          },
        },
      ],
    });
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      sources: [
        {
          source: "nport",
          since: "2026-10-28",
          run_id: "00000000-0000-4000-8000-000000000000",
          status: "ok",
          error: null,
          candidates: 2,
          documents_seen: 2,
          documents_new: 1,
          documents_skipped: 1,
          marks_new: 3,
          superseded_new: 0,
          unread: 0,
        },
      ],
    });
    const [, options] = runScheduledIngest.mock.calls[0]!;
    expect(options.startedAt).toBeInstanceOf(Date);
    expect(options.client.userAgent).toBe("OpenMarket-Index/0.1 (+https://openmarket.systems)");
  });
});
