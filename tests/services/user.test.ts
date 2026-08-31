import type { Kysely, Selectable } from "kysely";
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import {
  ADMIN_COOKIE_MAX_AGE_MS,
  getAdminCookieSecret,
  signAdminCookie,
  verifyAdminCookie,
} from "../../src/lib/auth/admin-cookie.js";
import {
  getUserCookieSecret,
  signCookiePayload,
  signUserCookie,
  USER_COOKIE_MAX_AGE_MS,
  verifyCookiePayload,
  verifyUserCookie,
} from "../../src/lib/auth/user-cookie.js";
import type { Database } from "../../src/lib/db/schema.js";
import {
  createOrResumeUser,
  InvalidUsernameError,
  normalizeUsername,
} from "../../src/lib/services/user.js";

const COOKIE_SECRET = Buffer.from(
  "0123456789abcdef0123456789abcdef",
  "utf8",
).toString("base64url");
const OTHER_COOKIE_SECRET = Buffer.from(
  "fedcba9876543210fedcba9876543210",
  "utf8",
).toString("base64url");
const PLACEHOLDER_SECRET = Buffer.from(
  "replace-me-with-a-random-cookie-secret",
  "utf8",
).toString("base64url");
const WEAK_COOKIE_SECRETS = [
  "",
  " ",
  "short",
  "test-secret-with-enough-entropy-to-model-production",
  Buffer.from("0123456789abcdef0123456789abcde", "utf8").toString(
    "base64url",
  ),
  PLACEHOLDER_SECRET,
  Buffer.alloc(32).toString("base64url"),
  `${COOKIE_SECRET}\n`,
  `${COOKIE_SECRET}=`,
];
const LINE_TERMINATORS = ["\n", "\r\n", "\u2028", "\u2029"];
const ISSUED_AT = 1_700_000_000_000;

describe("normalizeUsername", () => {
  it("normalizes valid usernames to lowercase", () => {
    expect(normalizeUsername("Alice_123")).toBe("alice_123");
    expect(normalizeUsername("ABC")).toBe("abc");
    expect(normalizeUsername("A".repeat(20))).toBe("a".repeat(20));
  });

  it("rejects usernames outside the documented ASCII format", () => {
    for (const username of [
      "ab",
      "a".repeat(21),
      "two words",
      "hyphen-name",
      "álîce",
      ...LINE_TERMINATORS.map((terminator) => `Alice${terminator}`),
      "",
    ]) {
      expect(() => normalizeUsername(username)).toThrow(InvalidUsernameError);
    }

    try {
      normalizeUsername("no-dashes");
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_INPUT" });
    }
  });
});

describe("createOrResumeUser", () => {
  it("atomically upserts normalized identity without replacing display casing", async () => {
    const storedUser: Selectable<Database["users"]> = {
      id: "00000000-0000-4000-8000-000000000001",
      username: "Alice_123",
      username_normalized: "alice_123",
      cash_balance_cents: "10000000",
      created_at: new Date("2025-01-01T00:00:00.000Z"),
    };
    let conflictUpdate: unknown;
    const doUpdateSet = vi.fn((update: unknown) => {
      conflictUpdate = update;
      return {};
    });
    const column = vi.fn(() => ({ doUpdateSet }));
    const executeTakeFirstOrThrow = vi.fn(async () => storedUser);
    const query: Record<string, Mock> = {};
    query.values = vi.fn(() => query);
    query.onConflict = vi.fn((callback: (builder: unknown) => unknown) => {
      callback({ column });
      return query;
    });
    query.returningAll = vi.fn(() => query);
    query.executeTakeFirstOrThrow = executeTakeFirstOrThrow;
    const insertInto = vi.fn(() => query);
    const db = { insertInto } as unknown as Kysely<Database>;

    const user = await createOrResumeUser(db, "ALICE_123");

    expect(user).toBe(storedUser);
    expect(insertInto).toHaveBeenCalledWith("users");
    expect(query.values).toHaveBeenCalledWith({
      username: "ALICE_123",
      username_normalized: "alice_123",
      cash_balance_cents: "10000000",
    });
    expect(column).toHaveBeenCalledWith("username_normalized");
    expect(conflictUpdate).toEqual({ username_normalized: "alice_123" });
    expect(conflictUpdate).not.toHaveProperty("username");
    expect(executeTakeFirstOrThrow).toHaveBeenCalledOnce();
  });

  it("validates before issuing a query", async () => {
    const insertInto = vi.fn();
    const db = { insertInto } as unknown as Kysely<Database>;

    for (const terminator of LINE_TERMINATORS) {
      await expect(
        createOrResumeUser(db, `Alice${terminator}`),
      ).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    }
    expect(insertInto).not.toHaveBeenCalled();
  });
});

describe("user cookies", () => {
  it("stores and verifies only normalized identity and issuance time", () => {
    const cookie = signUserCookie("Alice_123", COOKIE_SECRET, ISSUED_AT);

    expect(verifyUserCookie(cookie, COOKIE_SECRET, ISSUED_AT + 1)).toEqual({
      username: "alice_123",
      issuedAt: ISSUED_AT,
    });

    const [encodedPayload] = cookie.split(".");
    const payload = JSON.parse(
      Buffer.from(encodedPayload as string, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(payload).toEqual({ username: "alice_123", issuedAt: ISSUED_AT });
  });

  it("rejects visually hidden username suffixes in signed identities", () => {
    for (const terminator of LINE_TERMINATORS) {
      expect(() =>
        signUserCookie(`Alice${terminator}`, COOKIE_SECRET, ISSUED_AT),
      ).toThrow(InvalidUsernameError);

      const noncanonicalCookie = signCookiePayload(
        { username: `alice${terminator}`, issuedAt: ISSUED_AT },
        COOKIE_SECRET,
        "openmarket.user.v1",
      );
      expect(
        verifyUserCookie(noncanonicalCookie, COOKIE_SECRET, ISSUED_AT + 1),
      ).toBeNull();
    }
  });

  it("rejects tampering, wrong secrets, future cookies, and expired cookies", () => {
    const cookie = signUserCookie("Alice_123", COOKIE_SECRET, ISSUED_AT);
    const [payload, signature] = cookie.split(".") as [string, string];
    const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
    const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

    expect(
      verifyUserCookie(
        `${tamperedPayload}.${signature}`,
        COOKIE_SECRET,
        ISSUED_AT + 1,
      ),
    ).toBeNull();
    expect(
      verifyUserCookie(
        `${payload}.${tamperedSignature}`,
        COOKIE_SECRET,
        ISSUED_AT + 1,
      ),
    ).toBeNull();
    expect(
      verifyUserCookie(cookie, OTHER_COOKIE_SECRET, ISSUED_AT + 1),
    ).toBeNull();
    expect(verifyUserCookie(cookie, COOKIE_SECRET, ISSUED_AT - 1)).toBeNull();
    expect(
      verifyUserCookie(
        cookie,
        COOKIE_SECRET,
        ISSUED_AT + USER_COOKIE_MAX_AGE_MS - 1,
      ),
    ).toEqual({ username: "alice_123", issuedAt: ISSUED_AT });
    expect(
      verifyUserCookie(
        cookie,
        COOKIE_SECRET,
        ISSUED_AT + USER_COOKIE_MAX_AGE_MS,
      ),
    ).toBeNull();
  });

  it("requires canonical strong secrets at every signing boundary", () => {
    expect(getUserCookieSecret({ USER_COOKIE_SECRET: COOKIE_SECRET })).toBe(
      COOKIE_SECRET,
    );

    const userCookie = signUserCookie("Alice_123", COOKIE_SECRET, ISSUED_AT);
    const genericCookie = signCookiePayload(
      { value: true },
      COOKIE_SECRET,
      "test.domain",
    );
    expect(
      verifyCookiePayload(genericCookie, COOKIE_SECRET, "test.domain"),
    ).toEqual({ value: true });

    for (const weakSecret of WEAK_COOKIE_SECRETS) {
      expect(() =>
        getUserCookieSecret({ USER_COOKIE_SECRET: weakSecret }),
      ).toThrow(/USER_COOKIE_SECRET/);
      expect(() =>
        signUserCookie("Alice_123", weakSecret, ISSUED_AT),
      ).toThrow(/Cookie secret/);
      expect(() =>
        verifyUserCookie(userCookie, weakSecret, ISSUED_AT + 1),
      ).toThrow(/Cookie secret/);
      expect(() =>
        signCookiePayload({ value: true }, weakSecret, "test.domain"),
      ).toThrow(/Cookie secret/);
      expect(() =>
        verifyCookiePayload(genericCookie, weakSecret, "test.domain"),
      ).toThrow(/Cookie secret/);
    }
  });
});

describe("admin cookies", () => {
  it("verifies fresh cookies while rejecting tampering and user cookies", () => {
    const cookie = signAdminCookie(COOKIE_SECRET, ISSUED_AT);
    const userCookie = signUserCookie("Alice_123", COOKIE_SECRET, ISSUED_AT);
    const [payload, signature] = cookie.split(".") as [string, string];
    const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

    expect(verifyAdminCookie(cookie, COOKIE_SECRET, ISSUED_AT + 1)).toEqual({
      issuedAt: ISSUED_AT,
    });
    expect(
      verifyAdminCookie(
        `${payload}.${tamperedSignature}`,
        COOKIE_SECRET,
        ISSUED_AT + 1,
      ),
    ).toBeNull();
    expect(
      verifyAdminCookie(userCookie, COOKIE_SECRET, ISSUED_AT + 1),
    ).toBeNull();
  });

  it("expires admin bearer cookies after 15 minutes", () => {
    const cookie = signAdminCookie(COOKIE_SECRET, ISSUED_AT);

    expect(ADMIN_COOKIE_MAX_AGE_MS).toBe(15 * 60 * 1000);
    expect(verifyAdminCookie(cookie, COOKIE_SECRET, ISSUED_AT - 1)).toBeNull();
    expect(
      verifyAdminCookie(
        cookie,
        COOKIE_SECRET,
        ISSUED_AT + ADMIN_COOKIE_MAX_AGE_MS - 1,
      ),
    ).toEqual({ issuedAt: ISSUED_AT });
    expect(
      verifyAdminCookie(
        cookie,
        COOKIE_SECRET,
        ISSUED_AT + ADMIN_COOKIE_MAX_AGE_MS,
      ),
    ).toBeNull();
  });

  it("requires canonical strong admin secrets at every entry point", () => {
    expect(getAdminCookieSecret({ ADMIN_COOKIE_SECRET: COOKIE_SECRET })).toBe(
      COOKIE_SECRET,
    );
    expect(() => getAdminCookieSecret({})).toThrow(/ADMIN_COOKIE_SECRET/);

    const cookie = signAdminCookie(COOKIE_SECRET, ISSUED_AT);
    for (const weakSecret of WEAK_COOKIE_SECRETS) {
      expect(() =>
        getAdminCookieSecret({ ADMIN_COOKIE_SECRET: weakSecret }),
      ).toThrow(/ADMIN_COOKIE_SECRET/);
      expect(() => signAdminCookie(weakSecret, ISSUED_AT)).toThrow(
        /Cookie secret/,
      );
      expect(() =>
        verifyAdminCookie(cookie, weakSecret, ISSUED_AT + 1),
      ).toThrow(/Cookie secret/);
    }
  });
});
