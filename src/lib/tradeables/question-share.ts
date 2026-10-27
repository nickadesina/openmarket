import { formatTournamentDate } from "../client/format.js";
import type { QuestionDetail } from "../services/tournament/get-question.js";

/**
 * Open Graph and X card text for a question's share link (/t/q/[slug]), so
 * it unfurls with the question, its close date and what the tournament is.
 * No image: the card is text.
 */
export function questionShareMetadata(
  question: Pick<QuestionDetail, "title" | "closesAt" | "proposedBy">,
): {
  readonly description: string;
  readonly openGraph: {
    readonly type: "website";
    readonly siteName: string;
    readonly title: string;
    readonly description: string;
  };
  readonly twitter: {
    readonly card: "summary";
    readonly title: string;
    readonly description: string;
  };
} {
  const proposer = question.proposedBy === null ? "" : ` Proposed by ${question.proposedBy}.`;
  const description = `Closes ${formatTournamentDate(question.closesAt)}. A question in OpenMarket's log-scored forecasting tournament.${proposer}`;
  return {
    description,
    openGraph: { type: "website", siteName: "OpenMarket", title: question.title, description },
    twitter: { card: "summary", title: question.title, description },
  };
}
