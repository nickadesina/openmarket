import { NextRequest } from "next/server";
import { expect, it } from "vitest";

import { ARCHIVE_AS_OF_ISO, archiveNow } from "../../src/lib/config/archive.js";
import { proxy } from "../../src/proxy.js";

const origin = "https://v1.openmarket.systems";

function request(path: string, method = "GET"): NextRequest {
  return new NextRequest(`${origin}${path}`, { method });
}

it("refuses every write to the API", async () => {
  for (const path of [
    "/api/trade",
    "/api/forward/trade",
    "/api/quote",
    "/api/t/questions/x/forecast",
  ]) {
    const response = proxy(request(path, "POST"));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("ARCHIVED");
  }
});

it("refuses sign-in, cron and admin reads", () => {
  for (const path of [
    "/api/t/auth/x/start",
    "/api/cron/dealer",
    "/api/t/cron/provenance",
    "/api/admin/dealer",
  ]) {
    expect(proxy(request(path)).status).toBe(403);
  }
});

it("lets every other read through", () => {
  for (const path of [
    "/api/markets",
    "/api/ref/listings",
    "/api/instruments/1/quote",
    "/api/t/me",
  ]) {
    expect(proxy(request(path)).headers.get("x-middleware-next")).toBe("1");
  }
});

it("sends the sign-in and admin pages home", () => {
  for (const path of ["/t/signin", "/admin", "/admin/dealer", "/t/admin"]) {
    const response = proxy(request(path));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${origin}/`);
  }
});

it("answers every read at v1's last dealer run", () => {
  expect(archiveNow().toISOString()).toBe(ARCHIVE_AS_OF_ISO);
  expect(archiveNow()).not.toBe(archiveNow());
});
