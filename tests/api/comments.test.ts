import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { parseMutationBody } from "../../src/lib/api/mutation-route.js";
import { commentNetworkKey } from "../../src/lib/security/comment-address.js";

const ID = "00000000-0000-4000-8000-000000000001";
/** A body of up to 2,000 characters with a request id: the shape v1's comment input had. */
const bodySchema = z
  .object({ body: z.string().max(2_000), clientRequestId: z.uuid(), expectedUserId: z.uuid() })
  .strict();

function addressRequest(headers: HeadersInit): Request {
  return new Request("https://openmarket.test/api/comments", { headers });
}

describe("mutation body boundary", () => {
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
    await expect(parseMutationBody(request, bodySchema, 16_384)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("accepts the maximum body even when every character is JSON escaped", async () => {
    const request = new Request("https://openmarket.test", {
      method: "POST",
      body: `{"body":"${"\\u0061".repeat(2_000)}","clientRequestId":"${ID}","expectedUserId":"${ID}"}`,
    });
    const parsed = await parseMutationBody(request, bodySchema, 16_384);
    expect(parsed.body).toBe("a".repeat(2_000));
  });
});

describe("comment network trust", () => {
  const production = { NODE_ENV: "production", VERCEL: "1" };

  it("uses only the provider header, canonicalizes IPv6 and stores only a hash", () => {
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
    expect(first).not.toContain("2001");
    expect(
      commentNetworkKey(addressRequest({ "x-vercel-forwarded-for": "2001:db8::2" }), production),
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
    const environment = { NODE_ENV: "development" };
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
