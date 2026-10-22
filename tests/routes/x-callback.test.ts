import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOURNAMENT_SESSION_COOKIE } from "../../src/lib/auth/tournament-session.js";
import {
  beginAuthorization,
  OAUTH_STATE_COOKIE,
  type XProfile,
  xClientConfig,
} from "../../src/lib/auth/x-oauth.js";

const mocks = vi.hoisted(() => ({
  getRuntimeDatabase: vi.fn(),
  fetchXProfile: vi.fn(),
  upsertIdentity: vi.fn(),
  createTournamentSession: vi.fn(),
}));

vi.mock("../../src/lib/db/runtime.js", () => ({
  getRuntimeDatabase: mocks.getRuntimeDatabase,
}));
vi.mock("../../src/lib/auth/x-oauth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/auth/x-oauth.js")>()),
  fetchXProfile: mocks.fetchXProfile,
}));
vi.mock("../../src/lib/services/tournament/sign-in.js", () => ({
  upsertIdentity: mocks.upsertIdentity,
}));
vi.mock("../../src/lib/auth/tournament-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/auth/tournament-session.js")>()),
  createTournamentSession: mocks.createTournamentSession,
}));

const { GET } = await import("../../src/app/api/t/auth/x/callback/route.js");

const PROFILE: XProfile = {
  id: "123456",
  username: "Zetsurui",
  name: "Zetsurui",
  profileImageUrl: "https://pbs.twimg.com/profile_images/1/photo.jpg",
  verified: false,
  createdAt: null,
};

function callback(returnTo: string): Request {
  const config = xClientConfig()!;
  const { url, stateCookie } = beginAuthorization(config, returnTo);
  const state = new URL(url).searchParams.get("state")!;
  return new Request(`https://openmarket.systems/api/t/auth/x/callback?code=code&state=${state}`, {
    headers: { cookie: `${OAUTH_STATE_COOKIE}=${stateCookie}` },
  });
}

describe("GET /api/t/auth/x/callback", () => {
  beforeEach(() => {
    vi.stubEnv("X_CLIENT_ID", "client-id");
    vi.stubEnv("APP_ORIGIN", "https://openmarket.systems");
    mocks.getRuntimeDatabase.mockReturnValue({});
    mocks.fetchXProfile.mockResolvedValue(PROFILE);
    mocks.upsertIdentity.mockResolvedValue({ userId: "user-1", created: false });
    mocks.createTournamentSession.mockResolvedValue("t".repeat(43));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("lands a returning sign-in on the page that started it", async () => {
    const response = await GET(callback("/t/q/anthropic-s1-by-2026-12-31"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/t/q/anthropic-s1-by-2026-12-31");
    expect(response.headers.get("set-cookie")).toContain(
      `${TOURNAMENT_SESSION_COOKIE}=${"t".repeat(43)}`,
    );
    expect(mocks.upsertIdentity).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        provider: "x",
        handle: "Zetsurui",
        avatarUrl: "https://pbs.twimg.com/profile_images/1/photo.jpg",
      }),
    );
  });

  it("sends a first sign-in through the welcome step, carrying where it was headed", async () => {
    mocks.upsertIdentity.mockResolvedValue({ userId: "user-1", created: true });
    const fromQuestion = await GET(callback("/t/q/anthropic-s1-by-2026-12-31"));
    expect(fromQuestion.headers.get("location")).toBe(
      "/t/welcome?return=%2Ft%2Fq%2Fanthropic-s1-by-2026-12-31",
    );
    expect(fromQuestion.headers.get("set-cookie")).toContain(TOURNAMENT_SESSION_COOKIE);
    const fromQuestions = await GET(callback("/t"));
    expect(fromQuestions.headers.get("location")).toBe("/t/welcome");
  });

  it("still fails closed without opening a session", async () => {
    mocks.fetchXProfile.mockRejectedValue(new Error("X profile lookup failed (403)."));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET(callback("/t"));
    expect(response.headers.get("location")).toBe("/t?sign_in=failed");
    expect(response.headers.getSetCookie().map((cookie) => cookie.split("=")[0])).toEqual([
      OAUTH_STATE_COOKIE,
    ]);
    expect(mocks.createTournamentSession).not.toHaveBeenCalled();
  });
});
