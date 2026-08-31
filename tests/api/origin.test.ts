import { describe, expect, it } from "vitest";

import { ServiceError } from "../../src/lib/api/errors.js";
import {
  allowedOrigins,
  assertAllowedOrigin,
} from "../../src/lib/security/origin.js";

describe("request origin protection", () => {
  it("normalizes configured and Vercel origins", () => {
    expect(
      [...allowedOrigins({
        NODE_ENV: "production",
        APP_ORIGIN: "https://OpenMarket.example:443/",
        VERCEL_URL: "openmarket-git-main.vercel.app",
        VERCEL_BRANCH_URL: "https://openmarket-feature.vercel.app/",
      })],
    ).toEqual([
      "https://openmarket.example",
      "https://openmarket-git-main.vercel.app",
      "https://openmarket-feature.vercel.app",
    ]);
  });

  it("compares scheme and host exactly without suffix matching", () => {
    const env = {
      NODE_ENV: "production",
      APP_ORIGIN: "https://openmarket.example",
      VERCEL_URL: "openmarket.vercel.app",
    };

    expect(() =>
      assertAllowedOrigin("https://openmarket.example", env),
    ).not.toThrow();
    expect(() =>
      assertAllowedOrigin("https://openmarket.vercel.app", env),
    ).not.toThrow();

    for (const origin of [
      "http://openmarket.example",
      "https://openmarket.example.evil.test",
      "https://evil-openmarket.vercel.app",
      "https://openmarket.vercel.app.evil.test",
      "https://openmarket.example/path",
      "null",
    ]) {
      expect(() => assertAllowedOrigin(origin, env)).toThrow(ServiceError);
    }
  });

  it("allows only explicit local development origins", () => {
    const development = {
      NODE_ENV: "development",
      PORT: "4321",
    };
    for (const origin of [
      "http://localhost:4321",
      "http://127.0.0.1:4321",
      "http://[::1]:4321",
    ]) {
      expect(() => assertAllowedOrigin(origin, development)).not.toThrow();
    }

    for (const origin of [
      "http://localhost:3000",
      "https://localhost:4321",
      "http://sub.localhost:4321",
    ]) {
      expect(() => assertAllowedOrigin(origin, development)).toThrow(
        ServiceError,
      );
    }

    expect(
      allowedOrigins({
        NODE_ENV: "production",
        APP_ORIGIN: "http://localhost:3000",
      }).has("http://localhost:3000"),
    ).toBe(false);
  });

  it("rejects missing origins and malformed configuration", () => {
    expect(() => assertAllowedOrigin(undefined, {})).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(() =>
      allowedOrigins({ APP_ORIGIN: "https://example.com/path" }),
    ).toThrow();
    expect(() =>
      allowedOrigins({ VERCEL_URL: "http://example.vercel.app" }),
    ).toThrow();
  });
});
