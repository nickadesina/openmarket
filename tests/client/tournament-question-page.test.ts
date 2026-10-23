import { describe, expect, it, vi } from "vitest";
import { ServiceError } from "../../src/lib/api/errors.js";

const mocks = vi.hoisted(() => ({ getQuestion: vi.fn(), listLatestForecasts: vi.fn() }));
vi.mock("../../src/lib/db/runtime.js", () => ({ getRuntimeDatabase: () => ({}) }));
vi.mock("../../src/lib/services/tournament/get-question.js", () => mocks);
vi.mock("../../src/components/tournament-question/question-workspace.js", () => ({
  QuestionWorkspace: () => null,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));
const { default: QuestionPage } = await import("../../src/app/t/q/[slug]/page.js");

describe("question page", () => {
  it("returns a not-found boundary for an unknown question", async () => {
    mocks.getQuestion.mockRejectedValue(new ServiceError("QUESTION_NOT_FOUND", "Unknown"));
    mocks.listLatestForecasts.mockResolvedValue({ forecasts: [] });
    await expect(QuestionPage({ params: Promise.resolve({ slug: "missing" }) })).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });
});
