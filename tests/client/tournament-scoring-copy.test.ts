import { describe, expect, it } from "vitest";

import {
  formatBinaryScoreBounds,
  formatForwardScoreLadder,
  formatScoreAtFigure,
  formatScoreWhole,
  formatTimeAverageNote,
  formatWindowSpan,
  tournamentSettleCue,
  tournamentSettleSentences,
} from "../../src/lib/client/format.js";
import {
  binaryScoreBounds,
  forwardScoreLadder,
  windowCoverage,
} from "../../src/lib/client/tournament.js";
import { binaryScore, CLAMP_SCORE, forwardScore } from "../../src/lib/engine/tournament/score.js";

const DAY = 86_400_000;
/** 2026-12-31 23:59 America/Los_Angeles, the launch questions' expiry. */
const EXPIRY = "2027-01-01T07:59:00Z";

const binary = { kind: "binary", unit: null, levelLabel: null, expiryAt: EXPIRY } as const;
const forward = {
  kind: "forward",
  unit: "USD_T",
  levelLabel: "First-day market cap",
  expiryAt: EXPIRY,
} as const;

describe("formatScoreWhole", () => {
  it("rounds to a whole score with a sign and a true minus, and never prints −0", () => {
    expect(formatScoreWhole(100)).toBe("+100");
    expect(formatScoreWhole(86.25)).toBe("+86");
    expect(formatScoreWhole(0)).toBe("0");
    expect(formatScoreWhole(-0.4)).toBe("0");
    expect(formatScoreWhole(1e-12)).toBe("0");
    expect(formatScoreWhole(-58.5)).toBe("−58");
    expect(formatScoreWhole(CLAMP_SCORE)).toBe("−897");
  });
});

describe("settle copy", () => {
  it("cues each kind on the board", () => {
    expect(tournamentSettleCue(binary)).toBe("Binary · settles by Dec 31, 2026");
    expect(tournamentSettleCue(forward)).toBe("First-day market cap · settles at the print");
    expect(tournamentSettleCue({ ...forward, levelLabel: null })).toBe(
      "Forward · settles at the print",
    );
  });

  it("says what settles a binary and that anything else, nothing included, is NO", () => {
    expect(tournamentSettleSentences(binary)).toEqual([
      "Settles YES if what the question asks happens by Dec 31, 2026, as the rulebook defines it.",
      "Anything else, including nothing by Dec 31, 2026, is NO.",
    ]);
  });

  it("names a forward's level in the sentence and says a missing print voids", () => {
    expect(tournamentSettleSentences(forward)).toEqual([
      "Settles at the first-day market cap when it prints.",
      "If nothing prints by Dec 31, 2026, the question voids and nobody is scored.",
    ]);
    // A level that opens on a figure or an acronym keeps its case.
    expect(tournamentSettleSentences({ ...forward, levelLabel: "424(b) run-rate" })[0]).toBe(
      "Settles at the 424(b) run-rate when it prints.",
    );
    expect(tournamentSettleSentences({ ...forward, levelLabel: "ARR" })[0]).toBe(
      "Settles at the ARR when it prints.",
    );
    expect(tournamentSettleSentences({ ...forward, unit: "USD_B", levelLabel: null })[0]).toBe(
      "Settles at the figure the rulebook names, in USD billions, when it prints.",
    );
  });
});

describe("forward score preview", () => {
  it("scores the level typed exact, 10% off and 2× off with the engine", () => {
    const ladder = forwardScoreLadder(1.3);
    expect(ladder.rungs).toHaveLength(3);
    for (const rung of ladder.rungs) {
      expect(rung.score).toBe(forwardScore(1.3, rung.above));
      expect(forwardScore(1.3, rung.below)).toBeCloseTo(rung.score, 10);
    }
    expect(ladder.rungs.map((rung) => Math.round(rung.score))).toEqual([100, 86, 0]);
  });

  it("reads as one sentence in the question's unit", () => {
    expect(formatForwardScoreLadder(forwardScoreLadder(1.3), "USD_T")).toBe(
      "You enter $1.3T. If it settles at $1.3T you score +100; at $1.43T or $1.182T, +86; at $2.6T or $0.65T, 0.",
    );
    expect(formatForwardScoreLadder(forwardScoreLadder(412), "USD_B")).toBe(
      "You enter $412B. If it settles at $412B you score +100; at $453.2B or $374.5B, +86; at $824B or $206B, 0.",
    );
  });

  it("scores the level at a published figure", () => {
    expect(formatScoreAtFigure("crowd median", 1.25, forwardScore(1.3, 1.25), "USD_T")).toBe(
      "If it settles at the crowd median, $1.25T, you score +94.",
    );
    expect(formatScoreAtFigure("dealer mid", 3.9, forwardScore(1.3, 3.9), "USD_T")).toBe(
      "If it settles at the dealer mid, $3.9T, you score −58.",
    );
  });
});

describe("binary score preview", () => {
  it("states what 50% and certainty score, from the engine", () => {
    const bounds = binaryScoreBounds(0.999);
    expect(bounds.even).toBe(0);
    expect(bounds.sureRight).toBe(binaryScore(0.999, "yes"));
    expect(bounds.sureWrong).toBe(binaryScore(0.999, "no"));
    expect(formatBinaryScoreBounds(bounds)).toBe(
      "50% scores 0.0 either way; 99.9% scores +99.9 if right and −896.6 if wrong.",
    );
  });
});

describe("time-average note", () => {
  const opensAt = "2026-10-01T07:00:00Z";
  const windowEndsAt = new Date(Date.parse(opensAt) + 41 * DAY).toISOString();
  const now = Date.parse(opensAt) + 3 * DAY;

  it("says what a forecast submitted now would cover", () => {
    const coverage = windowCoverage({ opensAt, windowEndsAt, now, previous: undefined });
    expect(coverage).toEqual({ unit: "day", total: 41, covered: 38, since: null, atLeast: false });
    expect(formatTimeAverageNote("binary", coverage!)).toEqual([
      "Your score is averaged over the whole open window, 41 days; time before your first forecast counts as 0, the score of 50%.",
      "Forecast now and your number counts for 38 of those 41 days.",
    ]);
  });

  it("counts a single forecast from its submission to the close", () => {
    const submittedAt = new Date(Date.parse(opensAt) + 2 * DAY).toISOString();
    const coverage = windowCoverage({
      opensAt,
      windowEndsAt,
      now,
      previous: { submittedAt, submissionCount: 1 },
    });
    expect(coverage).toEqual({
      unit: "day",
      total: 41,
      covered: 39,
      since: submittedAt,
      atLeast: false,
    });
    expect(formatTimeAverageNote("forward", coverage!)).toEqual([
      "Your score is averaged over the whole open window, 41 days; time before your first forecast counts as 0, the score of a 2× miss.",
      "Your forecast counts from Oct 3, 2026 to the close: 39 of those 41 days.",
    ]);
  });

  it("states a lower bound after a revision, since only the latest submission is known", () => {
    const submittedAt = new Date(Date.parse(opensAt) + 2 * DAY).toISOString();
    const coverage = windowCoverage({
      opensAt,
      windowEndsAt,
      now,
      previous: { submittedAt, submissionCount: 3 },
    });
    expect(coverage?.atLeast).toBe(true);
    expect(formatTimeAverageNote("binary", coverage!)[1]).toBe(
      "Your forecasts count from Oct 3, 2026 or earlier to the close: at least 39 of those 41 days.",
    );
  });

  it("counts in hours under two days and minutes under two hours, and is absent once the window has passed", () => {
    const shortEnd = new Date(Date.parse(opensAt) + 36 * 3_600_000).toISOString();
    expect(
      windowCoverage({
        opensAt,
        windowEndsAt: shortEnd,
        now: Date.parse(opensAt) + 6 * 3_600_000,
        previous: undefined,
      }),
    ).toEqual({ unit: "hour", total: 36, covered: 30, since: null, atLeast: false });
    const hourEnd = new Date(Date.parse(opensAt) + 61 * 60_000).toISOString();
    expect(
      windowCoverage({
        opensAt,
        windowEndsAt: hourEnd,
        now: Date.parse(opensAt) + 60_000,
        previous: undefined,
      }),
    ).toEqual({ unit: "minute", total: 61, covered: 60, since: null, atLeast: false });
    expect(
      windowCoverage({ opensAt, windowEndsAt, now: Date.parse(windowEndsAt), previous: undefined }),
    ).toBeNull();
    expect(formatWindowSpan(1, "day")).toBe("1 day");
    expect(formatWindowSpan(36, "hour")).toBe("36 hours");
    expect(formatWindowSpan(61, "minute")).toBe("61 minutes");
  });
});
