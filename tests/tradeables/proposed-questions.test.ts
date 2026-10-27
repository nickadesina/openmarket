import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { questionInputSchema } from "../../src/lib/api/tournament-schemas.js";
import {
  LISTED_SLUGS,
  parseProposedQuestions,
} from "../../src/lib/tradeables/proposed-questions.js";
import { questionShareMetadata } from "../../src/lib/tradeables/question-share.js";

const OPENS_AT = "2026-10-27T00:00:00Z";
const file = readFileSync("docs/tradeables/questions/futuresearch.json", "utf8");
const entries = JSON.parse(file) as Record<string, unknown>[];

function withEntry(change: (entry: Record<string, unknown>) => Record<string, unknown>): string {
  return JSON.stringify([change({ ...entries[0]! })]);
}

describe("docs/tradeables/questions/futuresearch.json", () => {
  it("parses as seed:tournament --from reads it: each listed name's binary and forward", () => {
    const questions = parseProposedQuestions(file, OPENS_AT);
    expect(questions).toHaveLength(LISTED_SLUGS.length * 2);
    for (const slug of LISTED_SLUGS) {
      expect(
        questions
          .filter((q) => q.slug.startsWith(`${slug}-`))
          .map((q) => q.kind)
          .sort(),
      ).toEqual(["binary", "forward"]);
    }
    for (const question of questions) {
      expect(question.opens_at).toBe(OPENS_AT);
      expect(question.proposed_by).toBeNull();
      expect(question.rulebook_md).toContain("**OpenMarket rulebook 1.0.0**");
    }
    expect(file).not.toContain("—");
  });
});

describe("a proposer's file", () => {
  it("refuses any kind but binary and forward", () => {
    expect(() =>
      parseProposedQuestions(
        withEntry((e) => ({ ...e, kind: "bucket" })),
        OPENS_AT,
      ),
    ).toThrow(/question 1/);
  });

  it("refuses a question on a name that is not listed", () => {
    expect(() =>
      parseProposedQuestions(
        withEntry((e) => ({ ...e, slug: "stripe-round-by-2027-03-31" })),
        OPENS_AT,
      ),
    ).toThrow(/must start with a listed name/);
  });

  it("refuses an opens_at in the file, a repeated slug and an empty file", () => {
    expect(() =>
      parseProposedQuestions(
        withEntry((e) => ({ ...e, opens_at: OPENS_AT })),
        OPENS_AT,
      ),
    ).toThrow(/opens_at is set at seed time/);
    expect(() =>
      parseProposedQuestions(JSON.stringify([entries[0], entries[0]]), OPENS_AT),
    ).toThrow(/appears twice/);
    expect(() => parseProposedQuestions("[]", OPENS_AT)).toThrow();
  });

  it("takes a proposer's name as plain text, 1 to 100 characters", () => {
    const base = { ...entries[0]!, opens_at: OPENS_AT };
    expect(questionInputSchema.parse({ ...base, proposed_by: " FutureSearch " }).proposed_by).toBe(
      "FutureSearch",
    );
    expect(questionInputSchema.safeParse({ ...base, proposed_by: "" }).success).toBe(false);
    expect(questionInputSchema.safeParse({ ...base, proposed_by: "a\u0000b" }).success).toBe(false);
    expect(questionInputSchema.safeParse({ ...base, proposed_by: "x".repeat(101) }).success).toBe(
      false,
    );
  });
});

describe("a question's share card", () => {
  it("carries the title, the close date and what the tournament is", () => {
    const metadata = questionShareMetadata({
      title: "Will Modal announce a priced round by 2027-03-31?",
      closesAt: "2027-03-31T23:59:59.999Z",
      proposedBy: "FutureSearch",
    });
    expect(metadata.openGraph.title).toBe("Will Modal announce a priced round by 2027-03-31?");
    expect(metadata.description).toMatch(
      /^Closes .*2027\. A question in OpenMarket's log-scored forecasting tournament\. Proposed by FutureSearch\.$/,
    );
    expect(metadata.twitter).toMatchObject({ card: "summary", title: metadata.openGraph.title });
  });
});
