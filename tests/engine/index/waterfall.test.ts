import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CE_BASIS,
  CE_VERSION,
  type CertificateInput,
  type CertificateSeriesInput,
  commonEquivalent,
  liquidationWaterfall,
  structureGap,
  type Waterfall,
} from "../../../src/lib/engine/index/waterfall.js";

/**
 * Arithmetic only. No Delaware certificate has been transcribed yet
 * (docs/prompts/v2, P4), so the series here are placeholders and generated
 * structures, not any company's terms.
 */
const PROPERTY_OPTIONS = { numRuns: 300, seed: 0xce01 } as const;

function series(overrides: Partial<CertificateSeriesInput> = {}): CertificateSeriesInput {
  return {
    seriesLabel: "Series A Preferred",
    originalIssuePriceUsd: 10,
    liquidationMultiple: 1,
    participating: false,
    participationCapMultiple: null,
    seniority: 1,
    sharesAuthorized: 1_000_000,
    conversionPriceUsd: null,
    ratchet: null,
    ...overrides,
  };
}

function ok(result: ReturnType<typeof liquidationWaterfall>): Waterfall {
  if (result.status !== "ok") throw new Error(`unsupported: ${result.reason}`);
  return result;
}

function paidOut(result: Waterfall): number {
  return result.commonTotalUsd + result.series.reduce((sum, item) => sum + item.totalUsd, 0);
}

const seriesArb = fc
  .record({
    originalIssuePriceUsd: fc.double({ min: 0.1, max: 100, noNaN: true }),
    liquidationMultiple: fc.constantFrom(0, 0.5, 1, 1.5, 2, 3),
    participating: fc.boolean(),
    capExtra: fc.option(fc.constantFrom(0, 0.5, 1, 2), { nil: null }),
    seniority: fc.integer({ min: 1, max: 3 }),
    sharesAuthorized: fc.integer({ min: 1_000, max: 10_000_000 }),
    conversionRatio: fc.option(fc.double({ min: 0.5, max: 2, noNaN: true }), { nil: null }),
  })
  .map(
    (draw): Omit<CertificateSeriesInput, "seriesLabel"> => ({
      originalIssuePriceUsd: draw.originalIssuePriceUsd,
      liquidationMultiple: draw.liquidationMultiple,
      participating: draw.participating,
      participationCapMultiple:
        draw.participating && draw.capExtra !== null
          ? draw.liquidationMultiple + draw.capExtra
          : null,
      seniority: draw.seniority,
      sharesAuthorized: draw.sharesAuthorized,
      conversionPriceUsd:
        draw.conversionRatio === null ? null : draw.originalIssuePriceUsd * draw.conversionRatio,
      ratchet: null,
    }),
  );

const certificateArb = fc.array(seriesArb, { minLength: 1, maxLength: 4 }).map(
  (items): CertificateInput => ({
    series: items.map((item, index) => ({
      ...item,
      seriesLabel: `Series ${"ABCD"[index]} Preferred`,
    })),
  }),
);

describe("liquidationWaterfall", () => {
  it("pays a non-participating series its preference, then lets it convert", () => {
    const certificate = { series: [series()] };
    const low = ok(liquidationWaterfall(certificate, 9_000_000, 5_000_000));
    expect(low.series[0]!.totalUsd).toBe(5_000_000);
    expect(low.commonPerShareUsd).toBe(0);

    const high = ok(liquidationWaterfall(certificate, 9_000_000, 200_000_000));
    expect(high.series[0]!.converts).toBe(true);
    expect(high.commonPerShareUsd).toBeCloseTo(20, 12);
  });

  it("pays participating preferred its preference and its share, up to the cap", () => {
    const uncapped = ok(
      liquidationWaterfall({ series: [series({ participating: true })] }, 9_000_000, 100_000_000),
    );
    expect(uncapped.commonPerShareUsd).toBeCloseTo(9, 12);
    expect(uncapped.series[0]!.totalUsd).toBeCloseTo(19_000_000, 6);

    const capped = { series: [series({ participating: true, participationCapMultiple: 2 })] };
    const atCap = ok(liquidationWaterfall(capped, 9_000_000, 150_000_000));
    expect(atCap.series[0]!.totalUsd).toBeCloseTo(20_000_000, 6);
    expect(atCap.series[0]!.converts).toBe(false);
    const converted = ok(liquidationWaterfall(capped, 9_000_000, 300_000_000));
    expect(converted.series[0]!.converts).toBe(true);
    expect(converted.commonPerShareUsd).toBeCloseTo(30, 12);
  });

  it("pays by seniority, pari passu within a rank", () => {
    const certificate = {
      series: [
        series({ seriesLabel: "Senior", seniority: 1 }),
        series({ seriesLabel: "Junior", seniority: 2, originalIssuePriceUsd: 20 }),
      ],
    };
    const result = ok(liquidationWaterfall(certificate, 8_000_000, 15_000_000));
    expect(result.series.map((item) => item.totalUsd)).toEqual([10_000_000, 5_000_000]);

    const parity = {
      series: [
        series({ seriesLabel: "One" }),
        series({ seriesLabel: "Two", originalIssuePriceUsd: 30 }),
      ],
    };
    const shared = ok(liquidationWaterfall(parity, 8_000_000, 20_000_000));
    expect(shared.series.map((item) => item.totalUsd)).toEqual([5_000_000, 15_000_000]);
  });

  it("pays out exactly the equity value", () => {
    fc.assert(
      fc.property(
        certificateArb,
        fc.integer({ min: 1_000, max: 100_000_000 }),
        fc.double({ min: 0, max: 1e10, noNaN: true }),
        (certificate, commonShares, value) => {
          const result = ok(liquidationWaterfall(certificate, commonShares, value));
          expect(Math.abs(paidOut(result) - value)).toBeLessThanOrEqual(1e-9 * Math.max(1, value));
          for (const item of result.series) expect(item.totalUsd).toBeGreaterThanOrEqual(0);
        },
      ),
      PROPERTY_OPTIONS,
    );
  });

  it("returns unsupported for a ratchet or a term it does not model", () => {
    expect(liquidationWaterfall({ series: [series({ ratchet: { kind: "ipo" } })] }, 1, 1)).toEqual({
      status: "unsupported",
      ceVersion: CE_VERSION,
      reason: "ratchet on Series A Preferred",
    });
    expect(
      liquidationWaterfall({ series: [series()], unmodelledTerms: ["cumulative dividends"] }, 1, 1),
    ).toMatchObject({ status: "unsupported", reason: "terms not modelled: cumulative dividends" });
  });

  it("refuses malformed terms", () => {
    expect(() => liquidationWaterfall({ series: [] }, 1, 1)).toThrow(RangeError);
    expect(() =>
      liquidationWaterfall({ series: [series({ participationCapMultiple: 2 })] }, 1, 1),
    ).toThrow(RangeError);
    expect(() =>
      liquidationWaterfall(
        {
          series: [
            series({ participating: true, liquidationMultiple: 2, participationCapMultiple: 1 }),
          ],
        },
        1,
        1,
      ),
    ).toThrow(RangeError);
    expect(() => liquidationWaterfall({ series: [series(), series()] }, 1, 1)).toThrow(RangeError);
    expect(() => liquidationWaterfall({ series: [series({ seniority: 0 })] }, 1, 1)).toThrow(
      RangeError,
    );
    expect(() => liquidationWaterfall({ series: [series()] }, 0, 1)).toThrow(RangeError);
  });

  it("does not mutate the certificate", () => {
    const certificate = { series: [series({ participating: true }), series({ seriesLabel: "B" })] };
    const before = structuredClone(certificate);
    liquidationWaterfall(certificate, 1_000_000, 50_000_000);
    expect(certificate).toEqual(before);
  });
});

describe("commonEquivalent and structureGap", () => {
  it("states its version and basis", () => {
    const result = commonEquivalent({ series: [series()] }, 100_000_000, 10);
    expect(result).toMatchObject({ status: "ok", ceVersion: CE_VERSION, basis: CE_BASIS });
    expect(CE_BASIS).toBe("authorized");
  });

  it("measures participation as a gap", () => {
    const gap = structureGap({ series: [series({ participating: true })] }, 100_000_000, 10);
    expect(gap.status).toBe("ok");
    if (gap.status !== "ok") return;
    expect(gap.commonEquivalentUsd).toBeCloseTo(90_000_000, 4);
    expect(gap.gapLn).toBeCloseTo(Math.log(100 / 90), 12);
  });

  it("is unsupported when the authorized preferred fills the fully diluted count", () => {
    expect(
      commonEquivalent({ series: [series({ sharesAuthorized: 10_000_000 })] }, 100_000_000, 10),
    ).toMatchObject({ status: "unsupported" });
  });

  it("is 0 with every series 1× non-participating, at any headline at or above the stack", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            price: fc.double({ min: 0.1, max: 100, noNaN: true }),
            shares: fc.integer({ min: 1_000, max: 10_000_000 }),
            seniority: fc.integer({ min: 1, max: 3 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        fc.double({ min: 1, max: 3, noNaN: true }),
        fc.double({ min: 1.0001, max: 50, noNaN: true }),
        (draws, ppsOverTop, headroom) => {
          const certificate = {
            series: draws.map((draw, index) =>
              series({
                seriesLabel: `S${index}`,
                originalIssuePriceUsd: draw.price,
                sharesAuthorized: draw.shares,
                seniority: draw.seniority,
              }),
            ),
          };
          const pps = Math.max(...draws.map((draw) => draw.price)) * ppsOverTop;
          const preferredShares = draws.reduce((sum, draw) => sum + draw.shares, 0);
          const headline = pps * preferredShares * headroom;
          const gap = structureGap(certificate, headline, pps);
          expect(gap.status).toBe("ok");
          if (gap.status === "ok") expect(Math.abs(gap.gapLn)).toBeLessThan(1e-9);
        },
      ),
      PROPERTY_OPTIONS,
    );
  });

  it("never lowers the gap when a multiple rises", () => {
    let compared = 0;
    fc.assert(
      fc.property(
        certificateArb,
        fc.nat(),
        fc.constantFrom(0.25, 0.5, 1),
        fc.double({ min: 0.1, max: 200, noNaN: true }),
        fc.double({ min: 1.01, max: 20, noNaN: true }),
        (certificate, pick, step, pps, headroom) => {
          const index = pick % certificate.series.length;
          const target = certificate.series[index]!;
          const raised = target.liquidationMultiple + step;
          if (target.participationCapMultiple !== null && raised > target.participationCapMultiple)
            return;
          const asConverted = certificate.series.reduce(
            (sum, item) =>
              sum +
              (item.sharesAuthorized * item.originalIssuePriceUsd) /
                (item.conversionPriceUsd ?? item.originalIssuePriceUsd),
            0,
          );
          const headline = pps * asConverted * headroom;
          const higher = {
            series: certificate.series.map((item, other) =>
              other === index ? { ...item, liquidationMultiple: raised } : item,
            ),
          };
          const before = structureGap(certificate, headline, pps);
          const after = structureGap(higher, headline, pps);
          if (before.status !== "ok") return;
          if (after.status !== "ok") {
            expect(after.reason).toBe("common receives nothing at the headline");
            return;
          }
          expect(after.gapLn).toBeGreaterThanOrEqual(before.gapLn - 1e-9);
          compared += 1;
        },
      ),
      PROPERTY_OPTIONS,
    );
    // Skips (a cap the raise would cross, common paid nothing) stay a minority of draws.
    expect(compared).toBeGreaterThan(PROPERTY_OPTIONS.numRuns / 3);
  });
});
