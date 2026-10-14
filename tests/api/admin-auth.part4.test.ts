import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as adminLoginRoute } from "../../src/app/api/admin/login/route.js";
import {
  ADMIN_COOKIE_MAX_AGE_MS,
  signAdminCookie,
  verifyAdminCookie,
} from "../../src/lib/auth/admin-cookie.js";
import {
  ADMIN_SCRYPT_KEY_BYTES,
  ADMIN_SCRYPT_N,
  ADMIN_SCRYPT_P,
  ADMIN_SCRYPT_R,
  verifyAdminPassphrase,
} from "../../src/lib/auth/admin-passphrase.js";
import { requireCurrentAdmin } from "../../src/lib/auth/current-admin.js";

vi.mock("../../src/lib/services/rate-limit.js", () => ({
  consumeNetworkRateLimit: vi.fn(async () => {}),
  assertNetworkRateLimitAvailable: vi.fn(async () => {}),
}));
vi.mock("../../src/lib/db/runtime.js", () => ({
  getRuntimeDatabase: vi.fn(() => ({})),
}));

const APP_ORIGIN = "https://app.openmarket.test";
const PASSPHRASE = "correct horse battery staple";
const SALT = Buffer.from("0123456789abcdef", "utf8");
const DERIVED_KEY = scryptSync(PASSPHRASE, SALT, ADMIN_SCRYPT_KEY_BYTES, {
  N: ADMIN_SCRYPT_N,
  r: ADMIN_SCRYPT_R,
  p: ADMIN_SCRYPT_P,
  maxmem: 32 * 1024 * 1024,
});
const ENCODED_HASH = [
  "scrypt",
  String(ADMIN_SCRYPT_N),
  String(ADMIN_SCRYPT_R),
  String(ADMIN_SCRYPT_P),
  SALT.toString("base64url"),
  DERIVED_KEY.toString("base64url"),
].join("$");
const ADMIN_SECRET = Buffer.from(
  Array.from({ length: 32 }, (_unused, index) => index + 97),
).toString("base64url");

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
  vi.stubEnv("ADMIN_COOKIE_SECRET", ADMIN_SECRET);
  vi.stubEnv("ADMIN_PASSPHRASE_HASH", ENCODED_HASH);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Part 4 admin passphrase hash", () => {
  it("verifies the documented fixed-work-factor scrypt format", async () => {
    await expect(verifyAdminPassphrase(PASSPHRASE, ENCODED_HASH)).resolves.toBe(true);
    await expect(verifyAdminPassphrase("incorrect passphrase", ENCODED_HASH)).resolves.toBe(false);
  });

  it("rejects alternate work factors and noncanonical encodings", async () => {
    const alternateWorkFactor = ENCODED_HASH.replace("scrypt$16384$8$1$", "scrypt$32768$8$1$");
    const paddedKey = `${ENCODED_HASH}=`;
    const shortSalt = ENCODED_HASH.replace(
      SALT.toString("base64url"),
      SALT.subarray(0, 15).toString("base64url"),
    );

    await expect(verifyAdminPassphrase(PASSPHRASE, alternateWorkFactor)).rejects.toThrow(
      "scrypt$16384$8$1$salt$key",
    );
    await expect(verifyAdminPassphrase(PASSPHRASE, paddedKey)).rejects.toThrow("base64url");
    await expect(verifyAdminPassphrase(PASSPHRASE, shortSalt)).rejects.toThrow("16 bytes");
  });
});

describe("Part 4 current admin identity", () => {
  it("accepts one valid domain-separated cookie", () => {
    const issuedAt = Date.parse("2026-08-31T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(issuedAt + 1_000);
    const signed = signAdminCookie(ADMIN_SECRET, issuedAt);

    expect(
      requireCurrentAdmin(
        new Request(`${APP_ORIGIN}/api/admin/seed`, {
          headers: { cookie: `openmarket_admin=${signed}` },
        }),
      ),
    ).toEqual({ issuedAt });
  });

  it("rejects missing, duplicate, tampered, and expired admin cookies", () => {
    const now = Date.parse("2026-08-31T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const current = signAdminCookie(ADMIN_SECRET, now - 1_000);
    const expired = signAdminCookie(ADMIN_SECRET, now - ADMIN_COOKIE_MAX_AGE_MS);

    const requests = [
      new Request(`${APP_ORIGIN}/api/admin/seed`),
      new Request(`${APP_ORIGIN}/api/admin/seed`, {
        headers: {
          cookie: `openmarket_admin=${current}; openmarket_admin=${current}`,
        },
      }),
      new Request(`${APP_ORIGIN}/api/admin/seed`, {
        headers: { cookie: `openmarket_admin=${current}tampered` },
      }),
      new Request(`${APP_ORIGIN}/api/admin/seed`, {
        headers: { cookie: `openmarket_admin=${expired}` },
      }),
    ];

    for (const request of requests) {
      expect(() => requireCurrentAdmin(request)).toThrowError(
        expect.objectContaining({ code: "ADMIN_REQUIRED" }),
      );
    }
  });
});

describe("Part 4 admin login handler", () => {
  it("uses the configured hash and returns a verifiable production cookie", async () => {
    const response = await adminLoginRoute(
      new Request(`${APP_ORIGIN}/api/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: APP_ORIGIN,
        },
        body: JSON.stringify({ passphrase: PASSPHRASE }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: true });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("Max-Age=900");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Secure");
    const signedValue = setCookie.match(/openmarket_admin=([^;]+)/)?.[1];
    expect(signedValue).toBeTruthy();
    expect(verifyAdminCookie(signedValue ?? "", ADMIN_SECRET)).not.toBeNull();
  });

  it("does not set a cookie when passphrase verification fails", async () => {
    const response = await adminLoginRoute(
      new Request(`${APP_ORIGIN}/api/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: APP_ORIGIN,
        },
        body: JSON.stringify({ passphrase: "incorrect" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ADMIN_REQUIRED", details: {} },
    });
  });
});
