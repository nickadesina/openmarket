import { describe, expect, it } from "vitest";

import {
  safeReturnPath,
  signInLanding,
  welcomeContinuePath,
  welcomeHref,
} from "../../src/lib/auth/return-path.js";

describe("sign-in landings", () => {
  it("lets the welcome step be a sign-in's return path, but never its own continuation", () => {
    expect(safeReturnPath("/t/welcome")).toBe("/t/welcome");
    expect(welcomeContinuePath("/t/welcome")).toBe("/t");
    expect(welcomeContinuePath("/t/welcome?return=%2Fportfolio")).toBe("/t");
    expect(welcomeContinuePath("/t/welcomeback")).toBe("/t/welcomeback");
    expect(welcomeContinuePath("/t/q/anthropic-s1")).toBe("/t/q/anthropic-s1");
  });

  it("keeps the welcome step's continuation as strict as any return path", () => {
    expect(welcomeContinuePath("//evil.example/t")).toBe("/t");
    expect(welcomeContinuePath("https://evil.example/t")).toBe("/t");
    expect(welcomeContinuePath("/api/t/auth/logout")).toBe("/t");
    expect(welcomeContinuePath("/t/signin?return=/t")).toBe("/t");
    expect(welcomeContinuePath(null)).toBe("/t");
  });

  it("carries a new identity's destination through the welcome step", () => {
    expect(welcomeHref("/t")).toBe("/t/welcome");
    expect(welcomeHref(null)).toBe("/t/welcome");
    expect(welcomeHref("/t/welcome")).toBe("/t/welcome");
    expect(welcomeHref("/t/q/anthropic-s1")).toBe("/t/welcome?return=%2Ft%2Fq%2Fanthropic-s1");
    expect(welcomeHref("//evil.example")).toBe("/t/welcome");
  });

  it("onboards only a created identity; a returning one goes to its return path", () => {
    expect(signInLanding("/portfolio", true)).toBe("/t/welcome?return=%2Fportfolio");
    expect(signInLanding("/portfolio", false)).toBe("/portfolio");
    expect(signInLanding(null, false)).toBe("/t");
    expect(signInLanding("//evil.example", false)).toBe("/t");
  });
});
