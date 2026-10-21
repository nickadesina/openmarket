import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../../src/lib/auth/tournament-password.js";

const PASSWORD = "correct horse battery staple";
const SALT = Buffer.from("0123456789abcdef", "utf8");
const ENCODED_HASH = [
  "scrypt",
  "16384",
  "8",
  "1",
  SALT.toString("base64url"),
  scryptSync(PASSWORD, SALT, 64, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }).toString(
    "base64url",
  ),
].join("$");

describe("tournament password hash", () => {
  it("verifies the documented fixed-work-factor scrypt format", async () => {
    await expect(verifyPassword(PASSWORD, ENCODED_HASH)).resolves.toBe(true);
    await expect(verifyPassword("incorrect password", ENCODED_HASH)).resolves.toBe(false);
    expect(await hashPassword(PASSWORD)).toMatch(/^scrypt\$16384\$8\$1\$[\w-]{22}\$[\w-]{86}$/);
  });

  it("rejects alternate work factors and noncanonical encodings", async () => {
    const alternateWorkFactor = ENCODED_HASH.replace("scrypt$16384$8$1$", "scrypt$32768$8$1$");
    const paddedKey = `${ENCODED_HASH}=`;
    const shortSalt = ENCODED_HASH.replace(
      SALT.toString("base64url"),
      SALT.subarray(0, 15).toString("base64url"),
    );

    await expect(verifyPassword(PASSWORD, alternateWorkFactor)).rejects.toThrow(
      "scrypt$16384$8$1$salt$key",
    );
    await expect(verifyPassword(PASSWORD, paddedKey)).rejects.toThrow("base64url");
    await expect(verifyPassword(PASSWORD, shortSalt)).rejects.toThrow("16 bytes");
  });
});
