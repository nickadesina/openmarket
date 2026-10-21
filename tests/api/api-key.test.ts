import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import {
  API_KEY_PREFIX,
  bearerApiKey,
  generateApiKey,
  hashApiKey,
} from "../../src/lib/auth/api-key.js";

function request(authorization?: string): Request {
  return new Request("http://localhost:3000/api/ref/listings", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("reference API keys", () => {
  it("mints distinct prefixed 256-bit keys", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) {
      expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
      expect(key).toMatch(/^om_[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(key.slice(API_KEY_PREFIX.length), "base64url")).toHaveLength(32);
    }
  });

  it("stores the key's plain SHA-256 in lowercase hex, never the key", () => {
    const key = generateApiKey();
    const hash = hashApiKey(key);
    expect(hash).toBe(createHash("sha256").update(key).digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key.slice(API_KEY_PREFIX.length));
    expect(hashApiKey(generateApiKey())).not.toBe(hash);
  });

  it("reads a bearer key and leaves an unauthenticated request public", () => {
    const key = generateApiKey();
    expect(bearerApiKey(request(`Bearer ${key}`))).toBe(key);
    expect(bearerApiKey(request())).toBeNull();
  });

  it("refuses an Authorization header that is not a well-formed key", () => {
    for (const header of ["Bearer", "Basic abc", "Bearer om_short", `Token ${generateApiKey()}`]) {
      expect(() => bearerApiKey(request(header))).toThrow(ServiceError);
    }
  });
});
