import { afterEach, describe, expect, it, vi } from "vitest";
import params from "../../backtest/out/params.json";

afterEach(() => {
  vi.doUnmock("../../backtest/out/params.json");
  vi.resetModules();
});

describe("dealer parameter domains at import", () => {
  it.each([0, -1])("rejects non-positive sigma and cadence: %s", async (value) => {
    for (const tier of ["mega", "redhot"] as const) {
      for (const field of ["sigma", "cadence"] as const) {
        const invalid = structuredClone(params);
        if (field === "sigma") invalid.sigma_tier[tier] = value;
        else invalid.prior.cadence_months[tier] = value;
        vi.resetModules();
        vi.doMock("../../backtest/out/params.json", () => ({ default: invalid }));
        await expect(import("../../src/lib/config/dealer.js")).rejects.toThrow();
      }
    }
  });
  it.each([0, -1, 1.01])("rejects an invalid flag cap multiplier: %s", async (value) => {
    const invalid = structuredClone(params);
    invalid.dealer.flag_cap_mult = value;
    vi.doMock("../../backtest/out/params.json", () => ({ default: invalid }));
    await expect(import("../../src/lib/config/dealer.js")).rejects.toThrow();
  });
  it("accepts a full cap and negative finite mu", async () => {
    const valid = structuredClone(params);
    valid.dealer.flag_cap_mult = 1;
    valid.prior.mu_stepup_fallback.mega = -0.5;
    vi.doMock("../../backtest/out/params.json", () => ({ default: valid }));
    expect((await import("../../src/lib/config/dealer.js")).DEALER_PARAMS).toEqual(valid);
  });
});
