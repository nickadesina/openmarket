import { describe, expect, it } from "vitest";

import { questionInputSchema } from "../../src/lib/api/tournament-schemas.js";
import { DEALER_PARAMS } from "../../src/lib/config/dealer.js";
import { forwardQuestionLadder } from "../../src/lib/engine/dealer/question-ladder.js";
import {
  instrumentEnding,
  linkedQuestionInput,
  questionRulebookVersion,
} from "../../src/lib/services/dealer/tournament-bridge.js";

const LISTING = {
  binary_event: "priced_round" as const,
  tier: "mega" as const,
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
  it("asks the binary's question as a Yes/No closing at its expiry", () => {
    const input = linkedQuestionInput(LISTING, instrument("binary"), null, OPENS, "modal-x");
    expect(input).toMatchObject({
      slug: "modal-x",
      unit: "bool",
      title: "Will Modal announce a priced round by 2026-12-31?",
      opens_at: OPENS.toISOString(),
      closes_at: EXPIRES.toISOString(),
      rulebook_version: 1,
    });
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

  it("lays the forward's ladder from its listing mid, with the floor bucket", () => {
    const midLn = Math.log(15e9);
    const input = linkedQuestionInput(LISTING, instrument("forward"), midLn, OPENS, "modal-y");
    const ladder = forwardQuestionLadder(midLn, DEALER_PARAMS.sigma_tier.mega);
    expect(input).toMatchObject({
      unit: ladder.unit,
      expiry_at: EXPIRES.toISOString(),
      closes_at: EXPIRES.toISOString(),
      buckets: { edges: ladder.edges, floor_label: "No qualifying print by 2026-12-31" },
    });
    expect(input.description_md).toContain(ladder.version);
    expect(input.rulebook_md).toContain("voids this question");
    expect(questionInputSchema.safeParse(input).success).toBe(true);
  });

  it("refuses a forward without its mid", () => {
    expect(() => linkedQuestionInput(LISTING, instrument("forward"), null, OPENS, "m")).toThrow(
      RangeError,
    );
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
