import { describe, expect, it, vi } from "vitest";

import { parseMutationBody } from "../../src/lib/api/mutation-route.js";
import { commentInputSchema } from "../../src/lib/api/schemas.js";
import { commentNetworkKey } from "../../src/lib/security/comment-address.js";

const SECRET = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString(
  "base64url",
);
const ID = "00000000-0000-4000-8000-000000000001";
const input = {
  body: " A plain <script> string\nwith lines ",
  clientRequestId: ID,
  expectedUserId: ID,
};

function addressRequest(headers: HeadersInit): Request {
  return new Request("https://openmarket.test/api/comments", { headers });
}

describe("comment input boundary", () => {
  it("trims only the boundary and rejects empty, oversized, NUL and injected identity fields", () => {
    expect(commentInputSchema.parse(input).body).toBe("A plain <script> string\nwith lines");
    expect(commentInputSchema.parse({ ...input, body: "x".repeat(2_000) }).body).toHaveLength(
      2_000,
    );
    for (const body of [" \n\t ", "x".repeat(2_001), "before\0after"]) {
      expect(commentInputSchema.safeParse({ ...input, body }).success).toBe(false);
    }
    expect(commentInputSchema.safeParse({ ...input, userId: ID }).success).toBe(false);
    expect(commentInputSchema.safeParse({ ...input, username: "SomebodyElse" }).success).toBe(
      false,
    );
  });

  it("bounds streamed bytes without trusting a Content-Length claim", async () => {
    const cancel = vi.fn();
    const request = new Request("https://openmarket.test", {
      method: "POST",
      headers: { "content-length": "1" },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(4_096).fill(32));
        },
        cancel,
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(parseMutationBody(request, commentInputSchema, 16_384)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("accepts the maximum body even when every character is JSON escaped", async () => {
    const request = new Request("https://openmarket.test", {
      method: "POST",
      body: `{"body":"${"\\u0061".repeat(2_000)}","clientRequestId":"${ID}","expectedUserId":"${ID}"}`,
    });
    const parsed = await parseMutationBody(request, commentInputSchema, 16_384);
    expect(parsed.body).toBe("a".repeat(2_000));
  });
});

describe("comment network trust", () => {
  const production = { NODE_ENV: "production", VERCEL: "1", USER_COOKIE_SECRET: SECRET };

  it("uses only the provider header, canonicalizes IPv6 and hashes with the cookie secret", () => {
    const first = commentNetworkKey(
      addressRequest({
        "x-vercel-forwarded-for": "2001:db8::1",
        "x-forwarded-for": "192.0.2.5",
      }),
      production,
    );
    const alternate = commentNetworkKey(
      addressRequest({
        "x-vercel-forwarded-for": "2001:0db8:0000:0000:0000:0000:0000:0001",
        "x-forwarded-for": "192.0.2.99",
      }),
      production,
    );
    expect(first).toBe(alternate);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    const differentSecret = Buffer.from(
      Array.from({ length: 32 }, (_, index) => index + 65),
    ).toString("base64url");
    expect(
      commentNetworkKey(addressRequest({ "x-vercel-forwarded-for": "2001:db8::1" }), {
        ...production,
        USER_COOKIE_SECRET: differentSecret,
      }),
    ).not.toBe(first);
  });

  it("fails closed on missing, multiple or malformed trusted addresses and unsupported production", () => {
    for (const headers of [
      { "x-forwarded-for": "192.0.2.1" },
      { "x-vercel-forwarded-for": "192.0.2.1, 192.0.2.2" },
      { "x-vercel-forwarded-for": "not-an-address" },
    ]) {
      expect(() => commentNetworkKey(addressRequest(headers), production)).toThrowError(
        expect.objectContaining({ code: "POSTING_UNAVAILABLE" }),
      );
    }
    expect(() =>
      commentNetworkKey(addressRequest({ "x-vercel-forwarded-for": "192.0.2.1" }), {
        ...production,
        VERCEL: "0",
      }),
    ).toThrowError(expect.objectContaining({ code: "POSTING_UNAVAILABLE" }));
  });

  it("uses one local bucket regardless of arbitrary forwarding headers", () => {
    const environment = { NODE_ENV: "development", USER_COOKIE_SECRET: SECRET };
    const first = commentNetworkKey(addressRequest({}), environment);
    expect(
      commentNetworkKey(
        addressRequest({
          "x-forwarded-for": "192.0.2.1",
          "x-vercel-forwarded-for": "192.0.2.2",
        }),
        environment,
      ),
    ).toBe(first);
  });
});
