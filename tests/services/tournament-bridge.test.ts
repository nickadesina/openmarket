import { describe, expect, it } from "vitest";

import { questionInputSchema } from "../../src/lib/api/tournament-schemas.js";
import {
  expectedResolution,
  forwardQuestionUnit,
  inQuestionUnit,
  instrumentEnding,
  linkedQuestionInput,
  questionRulebookVersion,
} from "../../src/lib/services/dealer/tournament-bridge.js";

const LISTING = {
  binary_event: "priced_round" as const,
  company: { name: "Modal", slug: "modal" },
};
const OPENS = new Date("2026-10-01T00:05:00.000Z");
const EXPIRES = new Date("2026-12-31T23:59:59.999Z");

function instrument(kind: "binary" | "forward") {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind,
    epoch: 2,
    question:
      kind === "binary"
        ? "Will Modal announce a priced round by 2026-12-31?"
        : "What will Modal's next post-money valuation be?",
    expires_at: EXPIRES,
  };
}

describe("linkedQuestionInput", () => {
  it("asks the binary's question as a binary closing at its expiry", () => {
    const input = linkedQuestionInput(LISTING, instrument("binary"), null, OPENS, "modal-x");
    expect(input).toMatchObject({
      slug: "modal-x",
      kind: "binary",
      title: "Will Modal announce a priced round by 2026-12-31?",
      opens_at: OPENS.toISOString(),
      closes_at: EXPIRES.toISOString(),
      rulebook_version: 1,
    });
    expect(input).not.toHaveProperty("unit");
    expect(input.rulebook_md).toContain("OpenMarket rulebook 1.0.0");
    expect(input.rulebook_md).toContain("undisclosed valuation still resolves YES");
    // What the admin route would accept, so the bridge writes nothing the tournament refuses.
    expect(questionInputSchema.safeParse(input).success).toBe(true);
  });

  it("cites the S-1 rule on a lab's binary", () => {
    const input = linkedQuestionInput(
      { ...LISTING, binary_event: "public_s1" },
      instrument("binary"),
      null,
      OPENS,
      "openai-x",
    );
    expect(input.rulebook_md).toContain("confidential S-1");
  });

  it("asks the forward's question as one level in its unit, expiring with it, with no buckets", () => {
    const input = linkedQuestionInput(LISTING, instrument("forward"), "USD_B", OPENS, "modal-y");
    expect(input).toMatchObject({
      kind: "forward",
      unit: "USD_B",
      expiry_at: EXPIRES.toISOString(),
      closes_at: EXPIRES.toISOString(),
    });
    expect(input).not.toHaveProperty("buckets");
    expect(input.rulebook_md).toContain("Resolves** to the post-money in USD billions");
    expect(input.rulebook_md).toContain("voids this question, and nothing is scored");
    expect(`${input.description_md}\n${input.rulebook_md}`).not.toMatch(/bucket|floor/i);
    expect(questionInputSchema.safeParse(input).success).toBe(true);

    const trillions = linkedQuestionInput(LISTING, instrument("forward"), "USD_T", OPENS, "m");
    expect(trillions).toMatchObject({ unit: "USD_T" });
    expect(trillions.description_md).toContain("USD trillions");
  });

  it("refuses a forward without its unit", () => {
    expect(() => linkedQuestionInput(LISTING, instrument("forward"), null, OPENS, "m")).toThrow(
      RangeError,
    );
  });
});

describe("forwardQuestionUnit", () => {
  it("is USD_T from a $1T listing mid, else USD_B", () => {
    expect(forwardQuestionUnit(15.75e9)).toBe("USD_B");
    expect(forwardQuestionUnit(999.9e9)).toBe("USD_B");
    expect(forwardQuestionUnit(1e12)).toBe("USD_T");
    expect(forwardQuestionUnit(1.4e12)).toBe("USD_T");
    expect(() => forwardQuestionUnit(0)).toThrow(RangeError);
    expect(() => forwardQuestionUnit(Number.NaN)).toThrow(RangeError);
  });

  it("states a USD value in the question's unit", () => {
    expect(inQuestionUnit(10e9, "USD_B")).toBe(10);
    expect(inQuestionUnit(1.5e12, "USD_T")).toBe(1.5);
  });
});

describe("questionRulebookVersion", () => {
  it("is the dealer rulebook's major version", () => {
    expect(questionRulebookVersion("1.0.0")).toBe(1);
    expect(questionRulebookVersion("2.3.1")).toBe(2);
  });
});

describe("instrumentEnding", () => {
  it("reads a binary's YES and NO from its resolution record", () => {
    expect(
      instrumentEnding({
        outcome: "yes",
        announced_at: "2026-09-28T00:00:00.000Z",
        source_rank: 1,
        source_url: "https://example.test/release",
      }),
    ).toEqual({
      kind: "binary_yes",
      at: new Date("2026-09-28T00:00:00.000Z"),
      rank: 1,
      sourceUrl: "https://example.test/release",
    });
    expect(instrumentEnding({ outcome: "no" })).toEqual({ kind: "binary_no" });
  });

  it("reads a forward's settlement and its void", () => {
    expect(
      instrumentEnding({
        outcome: "settled",
        announced_at: "2026-09-28T00:00:00.000Z",
        source_rank: 2,
        source_url: null,
        settle_ln: Math.log(1e10),
        post_money_usd: 1e10,
        final: false,
      }),
    ).toEqual({
      kind: "forward_settled",
      at: new Date("2026-09-28T00:00:00.000Z"),
      rank: 2,
      sourceUrl: null,
      postMoneyUsd: 1e10,
      final: false,
    });
    expect(instrumentEnding({ outcome: "void", positions: 0 })).toEqual({ kind: "forward_void" });
  });
});

describe("expectedResolution", () => {
  const binary = { kind: "binary" as const, unit: null };
  const forwardB = { kind: "forward" as const, unit: "USD_B" as const };
  const forwardT = { kind: "forward" as const, unit: "USD_T" as const };
  const at = new Date("2026-09-28T00:00:00.000Z");
  const settled = {
    kind: "forward_settled" as const,
    at,
    rank: 1,
    sourceUrl: null,
    postMoneyUsd: 1.25e12,
    final: true,
  };

  it("resolves a binary question by its outcome", () => {
    expect(
      expectedResolution({ kind: "binary_yes", at, rank: 1, sourceUrl: null }, binary),
    ).toEqual({ outcome: "yes" });
    expect(expectedResolution({ kind: "binary_no" }, binary)).toEqual({ outcome: "no" });
  });

  it("resolves a forward question to the post-money in its unit", () => {
    expect(expectedResolution(settled, forwardT)).toEqual({ resolved_value: 1.25 });
    expect(expectedResolution(settled, forwardB)).toEqual({ resolved_value: 1250 });
  });

  it("gives a void, or a kind the question does not have, no resolution", () => {
    expect(expectedResolution({ kind: "forward_void" }, forwardB)).toBeNull();
    expect(expectedResolution(settled, binary)).toBeNull();
    expect(expectedResolution({ kind: "binary_no" }, forwardB)).toBeNull();
  });
});
